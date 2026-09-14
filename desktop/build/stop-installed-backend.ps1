[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,

    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 30,

    [string]$LogPath,

    [string]$TaskkillPath = (Join-Path $env:SystemRoot "System32\taskkill.exe")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-InstallerLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $line = "[{0}] {1}" -f [DateTime]::UtcNow.ToString("o"), $Message
    Write-Output $line

    if ([string]::IsNullOrWhiteSpace($LogPath)) {
        return
    }

    try {
        $logDirectory = Split-Path -Parent $LogPath
        if (
            -not [string]::IsNullOrWhiteSpace($logDirectory) -and
            -not (Test-Path -LiteralPath $logDirectory)
        ) {
            [void](New-Item -ItemType Directory -Path $logDirectory -Force)
        }
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    } catch {
        # Logging is diagnostic only. The path-scoped shutdown and verification
        # remain authoritative if the temporary directory cannot be written.
        Write-Output (
            "[{0}] Could not write installer diagnostic log: {1}" -f
            [DateTime]::UtcNow.ToString("o"),
            $_.Exception.Message
        )
    }
}

function Convert-ToComparablePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    try {
        # Win32_Process can report an 8.3 short path even when $INSTDIR is the
        # equivalent long path. Get-Item expands existing path components so
        # the comparison remains exact instead of falling back to image names.
        return (Get-Item -LiteralPath $Path -Force -ErrorAction Stop).FullName
    } catch {
        try {
            return [System.IO.Path]::GetFullPath($Path)
        } catch {
            return $null
        }
    }
}

try {
    $backendDirectory = Join-Path $InstallDir "resources\backend"
    $comparableBackendDirectory = Convert-ToComparablePath $backendDirectory
    if ([string]::IsNullOrWhiteSpace($comparableBackendDirectory)) {
        throw "Could not normalize installed backend path: $backendDirectory"
    }
    $backendRoot = $comparableBackendDirectory.TrimEnd("\") + "\"

    function Get-InstalledBackendProcesses {
        @(
            Get-CimInstance Win32_Process -ErrorAction Stop |
                Where-Object {
                    $executablePath = [string]$_.ExecutablePath
                    if ([string]::IsNullOrWhiteSpace($executablePath)) {
                        return $false
                    }

                    $comparablePath = Convert-ToComparablePath $executablePath
                    if ([string]::IsNullOrWhiteSpace($comparablePath)) {
                        return $false
                    }

                    return $comparablePath.StartsWith(
                        $backendRoot,
                        [System.StringComparison]::OrdinalIgnoreCase
                    )
                }
        )
    }

    Write-InstallerLog "Checking for processes under $backendRoot"
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

    do {
        $targets = @(Get-InstalledBackendProcesses)
        if ($targets.Count -eq 0) {
            Write-InstallerLog (
                "No installed shot2code backend processes remain; " +
                "pre-install shutdown is complete."
            )
            exit 0
        }

        $targetIds = [System.Collections.Generic.HashSet[int]]::new()
        foreach ($target in $targets) {
            [void]$targetIds.Add([int]$target.ProcessId)
        }

        # Kill only roots whose executable is inside this exact installation's
        # backend directory. taskkill /T then synchronously removes their
        # Copilot, Playwright/Chromium, driver, and conhost descendants even
        # when a descendant executable itself lives outside that directory.
        $roots = @(
            $targets |
                Where-Object {
                    -not $targetIds.Contains([int]$_.ParentProcessId)
                } |
                Sort-Object ProcessId
        )

        foreach ($root in $roots) {
            Write-InstallerLog (
                "Stopping installed backend tree PID {0}: {1}" -f
                $root.ProcessId,
                $root.ExecutablePath
            )

            $taskkill = Start-Process `
                -FilePath $TaskkillPath `
                -ArgumentList @(
                    "/PID",
                    [string]$root.ProcessId,
                    "/T",
                    "/F"
                ) `
                -WindowStyle Hidden `
                -Wait `
                -PassThru

            # A process can exit between enumeration and taskkill. The
            # authoritative result is the path-scoped verification below, not
            # taskkill's exit code.
            Write-InstallerLog (
                "taskkill PID {0} exited with code {1}." -f
                $root.ProcessId,
                $taskkill.ExitCode
            )
        }

        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    $remaining = @(Get-InstalledBackendProcesses)
    if ($remaining.Count -gt 0) {
        $details = $remaining |
            ForEach-Object {
                "PID $($_.ProcessId): $($_.ExecutablePath)"
            }
        throw (
            "Installed shot2code backend processes are still running after " +
            "$TimeoutSeconds seconds: $($details -join '; ')"
        )
    }

    Write-InstallerLog "Pre-install shutdown is complete."
    exit 0
} catch {
    $failure = (
        "Pre-install shutdown failed safely before any files were replaced: {0}" -f
        $_.Exception.Message
    )
    Write-InstallerLog $failure
    [Console]::Error.WriteLine($failure)
    exit 23
}
