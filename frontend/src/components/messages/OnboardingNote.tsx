export function OnboardingNote() {
  return (
    <div className="flex flex-col space-y-4 bg-green-700 p-2 rounded text-stone-200 text-sm">
      <span>
        To use shot2code, sign in with GitHub to use Copilot models, or add your
        own API key for OpenAI, Anthropic, or Gemini.{" "}
        <a
          href="https://github.com/ArasaniRohithReddy/shot2code/blob/main/Troubleshooting.md"
          className="inline underline hover:opacity-70"
          target="_blank"
        >
          Follow these instructions to get yourself a key.
        </a>{" "}
        and paste it in the Settings dialog (gear icon above). Your key stays on
        this device and is never sent anywhere except the provider you choose.
      </span>
    </div>
  );
}
