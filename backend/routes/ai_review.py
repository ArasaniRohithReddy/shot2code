"""Bounded AI review of generated source with no tools or writes."""

from __future__ import annotations

import json
import re
from typing import Any, Literal, cast

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai.types.chat import ChatCompletionMessageParam

from agent.providers.factory import (
    MissingProviderCredentialError,
    create_provider_session,
)
from integrations.config import (
    IntegrationConfigError,
    IntegrationSettings,
    parse_integration_settings,
)
from model_catalog import parse_model_selections
from provider_errors import classify_provider_error

router = APIRouter()

MAX_REVIEW_SOURCE_CHARS = 180_000
MAX_AI_FINDINGS = 12


def _empty_widths() -> list[int]:
    return []


class AiReviewRequest(BaseModel):
    source: str = Field(max_length=MAX_REVIEW_SOURCE_CHARS)
    sourcePath: str | None = None
    viewportWidths: list[int] = Field(default_factory=_empty_widths, max_length=4)
    model: str
    openAiApiKey: str | None = None
    openAiBaseURL: str | None = None
    anthropicApiKey: str | None = None
    geminiApiKey: str | None = None
    copilotGithubToken: str | None = None
    copilotUseLoggedInUser: bool = True
    copilotSdkByok: dict[str, Any] | None = None


class AiReviewFinding(BaseModel):
    severity: Literal["error", "warning", "info"]
    title: str
    evidence: str
    guidance: str


class AiReviewResponse(BaseModel):
    model: str
    findings: list[AiReviewFinding]


def _messages(request: AiReviewRequest) -> list[ChatCompletionMessageParam]:
    widths = ", ".join(f"{width}px" for width in sorted(set(request.viewportWidths)))
    system = """You are reviewing frontend source code. Do not rewrite the code and do not call tools.
Return only a JSON array with at most 12 objects. Each object must contain:
severity ("error", "warning", or "info"), title, evidence, and guidance.
Report high-confidence issues in correctness, responsiveness, accessibility,
interaction behavior, performance, maintainability, and visual consistency.
Do not repeat generic advice and do not claim WCAG certification."""
    user = f"""Artifact: {request.sourcePath or "composed-preview.html"}
Review widths: {widths or "not specified"}

SOURCE:
{request.source}"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _parse_findings(text: str) -> list[AiReviewFinding]:
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", candidate, re.I)
    if fenced:
        candidate = fenced.group(1)
    elif "[" in candidate and "]" in candidate:
        candidate = candidate[candidate.find("[") : candidate.rfind("]") + 1]
    try:
        raw = cast(object, json.loads(candidate))
    except json.JSONDecodeError as error:
        raise ValueError("The model returned an unreadable review.") from error
    if not isinstance(raw, list):
        raise ValueError("The model review was not a list of findings.")

    findings: list[AiReviewFinding] = []
    for raw_item in cast(list[object], raw)[:MAX_AI_FINDINGS]:
        if not isinstance(raw_item, dict):
            continue
        item = cast(dict[str, object], raw_item)
        severity = item.get("severity")
        if severity not in {"error", "warning", "info"}:
            severity = "warning"
        severity = cast(Literal["error", "warning", "info"], severity)
        title = str(item.get("title") or "").strip()[:160]
        evidence = str(item.get("evidence") or "").strip()[:600]
        guidance = str(item.get("guidance") or "").strip()[:600]
        if not title or not evidence or not guidance:
            continue
        findings.append(
            AiReviewFinding(
                severity=severity,
                title=title,
                evidence=evidence,
                guidance=guidance,
            )
        )
    return findings


@router.post("/api/review/ai", response_model=AiReviewResponse)
async def review_with_ai(request: AiReviewRequest) -> AiReviewResponse:
    specs, unknown = parse_model_selections([request.model])
    if unknown or not specs:
        raise HTTPException(status_code=400, detail="Select a model available to this build.")
    spec = specs[0]

    try:
        parsed = parse_integration_settings(
            {"copilotSdkByok": request.copilotSdkByok}
            if request.copilotSdkByok is not None
            else {}
        )
        integrations = IntegrationSettings(byok=parsed.byok)
        byok_connection = integrations.byok_for(spec.selection_id)
        session = create_provider_session(
            model=spec.model,
            prompt_messages=_messages(request),
            should_generate_images=False,
            should_extract_assets=False,
            openai_api_key=request.openAiApiKey,
            openai_base_url=request.openAiBaseURL,
            anthropic_api_key=request.anthropicApiKey,
            gemini_api_key=request.geminiApiKey,
            replicate_api_key=None,
            copilot_github_token=request.copilotGithubToken,
            copilot_use_logged_in_user=request.copilotUseLoggedInUser,
            integrations=integrations,
            byok_connection=byok_connection,
            byok_wire_model=spec.wire_model,
            canonical_tools_override=[],
            copilot_web_search_enabled=False,
            copilot_skills_enabled=False,
        )
        try:
            turn = await session.stream_turn(lambda _event: _no_event())
        finally:
            await session.close()
        return AiReviewResponse(
            model=spec.selection_id,
            findings=_parse_findings(turn.assistant_text),
        )
    except (IntegrationConfigError, MissingProviderCredentialError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        info = classify_provider_error(error, "review")
        raise HTTPException(status_code=502, detail=info.message) from error


async def _no_event() -> None:
    return None
