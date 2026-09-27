"""Provider-neutral web search: one tool, every runtime, hard limits.

The behaviours worth protecting here are the ones a refactor would quietly
break: that ``search_web`` reaches native OpenAI/Anthropic/Gemini *and* both
Copilot runtimes, that it is never advertised when it cannot run, that the
budgets hold, that a provider's answer is cut down before a model sees it, that
a failure says what to do about it, and that a search key never reaches a
summary, a log line or a tool argument.
"""

from typing import TYPE_CHECKING, Any, cast

import httpx
import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

import copilot
from agent.providers.anthropic import (
    AnthropicProviderSession,
    serialize_anthropic_tools,
)
from agent.providers.factory import create_provider_session
from agent.providers.gemini import GeminiProviderSession, serialize_gemini_tools
from agent.providers.github_copilot import (
    CopilotProviderSession,
    serialize_copilot_tools,
)
from agent.providers.openai import OpenAIProviderSession, serialize_openai_tools
from agent.state import AgentFileState
from agent.tools import (
    AgentToolRuntime,
    canonical_tool_definitions,
    summarize_tool_input,
)
from agent.tools.types import ToolCall
from integrations.config import parse_integration_settings
from llm import Llm
from web_search.config import (
    MAX_INCLUDE_DOMAINS,
    MAX_RESULTS,
    MAX_SEARCHES_PER_GENERATION,
    MAX_SEARCHES_PER_TURN,
    MAX_SNIPPET_CHARS,
    MAX_TITLE_CHARS,
    MAX_TOTAL_CHARS,
    WebSearchConfigError,
    WebSearchSettings,
    merge_web_search_api_key,
    normalize_domain,
    parse_web_search_settings,
)
from web_search.errors import WebSearchError
from web_search.providers import WebSearchResult, run_provider_search
from web_search.tool import (
    UNTRUSTED_CONTENT_WARNING,
    WEB_SEARCH_TOOL_NAME,
    WebSearchBudget,
    WebSearchRuntime,
    bound_results,
)

PROMPT: list[dict[str, Any]] = [
    {"role": "system", "content": "You are a test."},
    {"role": "user", "content": "Build a page."},
]

TAVILY_KEY = "tvly-secret-value"
EXA_KEY = "exa-secret-value"


def keyed(provider: str = "tavily", **overrides: Any) -> WebSearchSettings:
    base: dict[str, Any] = {
        "enabled": True,
        "provider": provider,
        "access_mode": "api-key",
        "api_key": TAVILY_KEY if provider == "tavily" else EXA_KEY,
    }
    base.update(overrides)
    return WebSearchSettings(**base)


def session_for(model: Llm, **overrides: object):
    kwargs: dict[str, object] = {
        "model": model,
        "prompt_messages": PROMPT,
        "should_generate_images": False,
        "openai_api_key": "sk-openai",
        "openai_base_url": None,
        "anthropic_api_key": "sk-anthropic",
        "gemini_api_key": "gemini-key",
        "replicate_api_key": None,
    }
    kwargs.update(overrides)
    return create_provider_session(**kwargs)  # pyright: ignore[reportArgumentType]


class StubTransport(httpx.AsyncBaseTransport):
    """Answers the one POST a search makes, and records what was sent."""

    def __init__(self, response: httpx.Response):
        self.response = response
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.response.request = request
        return self.response


def client_for(
    payload: object = None,
    status_code: int = 200,
    text: str | None = None,
) -> tuple[httpx.AsyncClient, StubTransport]:
    if text is not None:
        response = httpx.Response(status_code, text=text)
    else:
        response = httpx.Response(status_code, json=payload)
    transport = StubTransport(response)
    return httpx.AsyncClient(transport=transport), transport


def tavily_body(*entries: dict[str, Any]) -> dict[str, Any]:
    return {"results": list(entries)}


def tavily_hit(url: str = "https://developer.mozilla.org/en-US/docs/Web/CSS") -> dict[str, Any]:
    return {
        "title": "CSS reference",
        "url": url,
        "content": "Cascading Style Sheets reference material.",
        "score": 0.9,
    }


class TestToolSerializationAcrossProviders:
    """The same canonical tool has to survive every provider's serializer."""

    def test_canonical_definitions_include_search_web_when_enabled(self) -> None:
        names = [
            tool.name
            for tool in canonical_tool_definitions(True, web_search_enabled=True)
        ]

        assert WEB_SEARCH_TOOL_NAME in names

    def test_canonical_definitions_exclude_search_web_by_default(self) -> None:
        names = [tool.name for tool in canonical_tool_definitions(True)]

        assert WEB_SEARCH_TOOL_NAME not in names

    def tool(self):
        return next(
            tool
            for tool in canonical_tool_definitions(True, web_search_enabled=True)
            if tool.name == WEB_SEARCH_TOOL_NAME
        )

    def test_schema_bounds_results_domains_and_recency(self) -> None:
        schema = self.tool().parameters
        properties = schema["properties"]

        assert schema["required"] == ["query"]
        assert properties["max_results"]["maximum"] == MAX_RESULTS
        assert properties["max_results"]["minimum"] == 1
        assert properties["include_domains"]["maxItems"] == MAX_INCLUDE_DOMAINS
        assert properties["recency"]["enum"] == [
            "any",
            "day",
            "week",
            "month",
            "year",
        ]

    def test_openai_serialization_keeps_the_tool_strict(self) -> None:
        serialized = serialize_openai_tools([self.tool()])[0]

        assert serialized["name"] == WEB_SEARCH_TOOL_NAME
        assert serialized["strict"] is True
        # Strict mode requires every property, so an omitted optional arrives
        # as null. The runtime clamps those, which the budget tests cover.
        assert set(serialized["parameters"]["required"]) == {
            "query",
            "max_results",
            "recency",
            "include_domains",
        }
        assert serialized["parameters"]["additionalProperties"] is False

    def test_anthropic_serialization_carries_the_schema(self) -> None:
        serialized = serialize_anthropic_tools([self.tool()])[0]

        assert serialized["name"] == WEB_SEARCH_TOOL_NAME
        assert serialized["input_schema"]["properties"]["query"]["type"] == "string"

    def test_gemini_serialization_declares_the_function(self) -> None:
        declarations = serialize_gemini_tools([self.tool()])[0].function_declarations

        assert declarations is not None
        assert declarations[0].name == WEB_SEARCH_TOOL_NAME

    def test_copilot_serialization_passes_the_definition_through(self) -> None:
        assert serialize_copilot_tools([self.tool()])[0].name == WEB_SEARCH_TOOL_NAME


class TestGatingPerRuntime:
    """Every runtime gets the tool, and only when a provider can answer."""

    def tool_names(self, session: object) -> list[str]:
        """Tool names for whichever serializer this runtime used.

        Each provider stores a different shape - OpenAI/Anthropic dicts, Gemini
        function declarations, Copilot the canonical definitions themselves -
        which is exactly the surface this test is meant to cover.
        """
        raw = getattr(session, "_tools", None)
        if raw is None:
            raw = getattr(session, "_tool_definitions", [])
        names: list[str] = []
        for entry in cast(list[Any], raw):
            declarations = getattr(entry, "function_declarations", None)
            if declarations:
                names.extend(
                    str(declaration.name) for declaration in cast(Any, declarations)
                )
            elif isinstance(entry, dict):
                names.append(str(entry.get("name")))
            else:
                names.append(str(getattr(entry, "name", "")))
        return names

    @pytest.mark.parametrize(
        ("model", "session_type"),
        [
            (Llm.GPT_5_6_SOL_HIGH, OpenAIProviderSession),
            (Llm.CLAUDE_OPUS_5_MAX, AnthropicProviderSession),
            (Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL, GeminiProviderSession),
            (Llm.COPILOT_GPT_5_6_SOL, CopilotProviderSession),
        ],
    )
    def test_every_runtime_receives_search_web(
        self, model: Llm, session_type: type
    ) -> None:
        session = session_for(
            model,
            web_search=keyed(),
            copilot_github_token="github_pat_test",
        )

        assert isinstance(session, session_type)
        assert WEB_SEARCH_TOOL_NAME in self.tool_names(session)

    def test_gemini_receives_it_as_a_function_declaration(self) -> None:
        session = session_for(Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL, web_search=keyed())

        declarations = cast(Any, session)._tools[0].function_declarations  # pyright: ignore[reportPrivateUsage]
        assert WEB_SEARCH_TOOL_NAME in [entry.name for entry in declarations]

    def test_byok_sessions_receive_search_web_too(self) -> None:
        settings = parse_integration_settings(
            {
                "copilotSdkByok": {
                    "enabled": True,
                    "provider": "openai",
                    "baseUrl": "https://api.example.com/v1",
                    "apiKey": "sk-byok",
                }
            }
        )
        session = session_for(
            Llm.GPT_5_6_SOL_HIGH,
            integrations=settings,
            byok_connection=settings.usable_byok,
            web_search=keyed(),
        )

        assert isinstance(session, CopilotProviderSession)
        assert WEB_SEARCH_TOOL_NAME in self.tool_names(session)

    def test_a_disabled_configuration_is_never_advertised(self) -> None:
        session = session_for(
            Llm.GPT_5_6_SOL_HIGH, web_search=keyed(enabled=False)
        )

        assert WEB_SEARCH_TOOL_NAME not in self.tool_names(session)

    def test_an_enabled_configuration_without_a_key_is_never_advertised(self) -> None:
        session = session_for(
            Llm.GPT_5_6_SOL_HIGH, web_search=keyed(api_key=None)
        )

        assert WEB_SEARCH_TOOL_NAME not in self.tool_names(session)

    def test_video_runs_keep_search_web_while_dropping_screenshots(self) -> None:
        video_prompt: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:video/mp4;base64,AAAA"},
                    }
                ],
            }
        ]
        session = session_for(
            Llm.COPILOT_GPT_5_6_SOL,
            prompt_messages=video_prompt,
            copilot_github_token="github_pat_test",
            web_search=keyed(),
        )

        names = self.tool_names(session)
        assert WEB_SEARCH_TOOL_NAME in names
        assert "screenshot_preview" not in names


class TestCopilotBuiltInCollision:
    """Exactly one search tool per session, and it is the canonical one."""

    def copilot_session(self, **overrides: object) -> CopilotProviderSession:
        session = session_for(
            Llm.COPILOT_GPT_5_6_SOL,
            copilot_github_token="github_pat_test",
            **overrides,
        )
        assert isinstance(session, CopilotProviderSession)
        return session

    def builtins(self, session: CopilotProviderSession) -> list[str]:
        return session._available_tools().to_list()  # pyright: ignore[reportPrivateUsage]

    def test_builtin_alone_still_works_for_copilot_entitlement(self) -> None:
        session = self.copilot_session(copilot_web_search_enabled=True)

        assert self.builtins(session) == ["custom:*", "builtin:web_search"]

    def test_canonical_search_suppresses_the_builtin(self) -> None:
        session = self.copilot_session(
            copilot_web_search_enabled=True, web_search=keyed()
        )

        assert self.builtins(session) == ["custom:*"]
        assert WEB_SEARCH_TOOL_NAME in [
            tool.name
            for tool in session._tool_definitions  # pyright: ignore[reportPrivateUsage]
        ]

    def test_an_unusable_canonical_configuration_leaves_the_builtin_alone(
        self,
    ) -> None:
        session = self.copilot_session(
            copilot_web_search_enabled=True, web_search=keyed(api_key=None)
        )

        assert self.builtins(session) == ["custom:*", "builtin:web_search"]

    def test_byok_sessions_follow_the_same_rule(self) -> None:
        settings = parse_integration_settings(
            {
                "copilotSdkByok": {
                    "enabled": True,
                    "provider": "openai",
                    "baseUrl": "https://api.example.com/v1",
                    "apiKey": "sk-byok",
                }
            }
        )
        session = session_for(
            Llm.GPT_5_6_SOL_HIGH,
            integrations=settings,
            byok_connection=settings.usable_byok,
            copilot_web_search_enabled=True,
            web_search=keyed(),
        )

        assert isinstance(session, CopilotProviderSession)
        assert self.builtins(session) == ["custom:*"]


class TestConfigurationParsing:
    def test_absent_block_is_off(self) -> None:
        settings = parse_web_search_settings({})

        assert settings.enabled is False
        assert settings.is_usable is False

    def test_a_keyed_block_round_trips(self) -> None:
        settings = parse_web_search_settings(
            {
                "webSearch": {
                    "enabled": True,
                    "provider": "exa",
                    "accessMode": "api-key",
                    "apiKey": EXA_KEY,
                }
            }
        )

        assert settings.provider == "exa"
        assert settings.api_key == EXA_KEY
        assert settings.is_usable is True

    def test_keyless_drops_any_saved_key(self) -> None:
        settings = parse_web_search_settings(
            {
                "webSearch": {
                    "enabled": True,
                    "provider": "tavily",
                    "accessMode": "keyless",
                    "apiKey": TAVILY_KEY,
                }
            }
        )

        assert settings.api_key is None
        assert settings.is_usable is True

    def test_keyless_is_refused_for_a_provider_without_one(self) -> None:
        settings = parse_web_search_settings(
            {
                "webSearch": {
                    "enabled": True,
                    "provider": "exa",
                    "accessMode": "keyless",
                }
            }
        )

        assert settings.is_usable is False
        assert "keyless" in (settings.unusable_reason or "")

    def test_an_unknown_provider_is_refused(self) -> None:
        with pytest.raises(WebSearchConfigError):
            parse_web_search_settings(
                {"webSearch": {"enabled": True, "provider": "brave"}}
            )

    def test_a_key_with_whitespace_is_refused_without_quoting_it(self) -> None:
        with pytest.raises(WebSearchConfigError) as error:
            parse_web_search_settings(
                {"webSearch": {"enabled": True, "apiKey": "tvly secret"}}
            )

        assert "tvly secret" not in str(error.value)

    def test_environment_only_fills_a_missing_key(self) -> None:
        request = parse_web_search_settings(
            {"webSearch": {"enabled": True, "provider": "tavily"}}
        )

        merged = merge_web_search_api_key(request, "tvly-from-env")

        assert merged.api_key == "tvly-from-env"
        assert merged.enabled is True

    def test_environment_never_overrides_an_explicit_key(self) -> None:
        merged = merge_web_search_api_key(keyed(), "tvly-from-env")

        assert merged.api_key == TAVILY_KEY

    def test_environment_never_keys_a_keyless_connection(self) -> None:
        keyless = parse_web_search_settings(
            {"webSearch": {"enabled": True, "accessMode": "keyless"}}
        )

        assert merge_web_search_api_key(keyless, "tvly-from-env").api_key is None

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("https://developer.mozilla.org/en-US/", "developer.mozilla.org"),
            ("DOCS.PYTHON.ORG", "docs.python.org"),
            (".python.org", "python.org"),
            ("evil.com@good.com", None),
            ("localhost", None),
            ("example.com:8443", None),
            ("*.example.com", None),
            ("", None),
        ],
    )
    def test_domain_normalization(self, raw: str, expected: str | None) -> None:
        assert normalize_domain(raw) == expected


class TestSecretHandling:
    def test_the_summary_never_carries_the_key(self) -> None:
        payload = keyed().safe_metadata()

        assert TAVILY_KEY not in str(payload)
        assert payload["hasApiKey"] is True
        assert payload["endpoint"] == "https://api.tavily.com/search"

    def test_the_exa_summary_never_carries_the_key(self) -> None:
        assert EXA_KEY not in str(keyed("exa").safe_metadata())

    def test_tool_argument_summaries_drop_anything_extra(self) -> None:
        summary = summarize_tool_input(
            ToolCall(
                id="1",
                name=WEB_SEARCH_TOOL_NAME,
                arguments={
                    "query": "  css grid   reference ",
                    "apiKey": TAVILY_KEY,
                    "authorization": f"Bearer {TAVILY_KEY}",
                    "include_domains": ["developer.mozilla.org"],
                },
            ),
            AgentFileState(),
        )

        assert TAVILY_KEY not in str(summary)
        assert summary["query"] == "css grid reference"
        assert summary["include_domains"] == ["developer.mozilla.org"]

    @pytest.mark.asyncio
    async def test_a_failure_message_never_quotes_the_key(self) -> None:
        client, _ = client_for({"detail": "Unauthorized"}, status_code=401)
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert outcome.ok is False
        assert TAVILY_KEY not in str(outcome.result) + str(outcome.summary)


class TestProviderRequests:
    @pytest.mark.asyncio
    async def test_tavily_sends_a_bearer_key_and_no_raw_content(self) -> None:
        client, transport = client_for(tavily_body(tavily_hit()))

        await run_provider_search(
            keyed(),
            query="css grid",
            max_results=3,
            recency="week",
            include_domains=["developer.mozilla.org"],
            client=client,
        )
        await client.aclose()

        request = transport.requests[0]
        body = cast(dict[str, Any], __import__("json").loads(request.content))
        assert str(request.url) == "https://api.tavily.com/search"
        assert request.headers["authorization"] == f"Bearer {TAVILY_KEY}"
        assert body["include_raw_content"] is False
        assert body["include_answer"] is False
        assert body["time_range"] == "week"
        assert body["include_domains"] == ["developer.mozilla.org"]

    @pytest.mark.asyncio
    async def test_tavily_keyless_sends_the_documented_header_and_no_key(
        self,
    ) -> None:
        client, transport = client_for(tavily_body(tavily_hit()))
        settings = WebSearchSettings(enabled=True, access_mode="keyless")

        await run_provider_search(
            settings,
            query="css grid",
            max_results=1,
            recency="any",
            include_domains=[],
            client=client,
        )
        await client.aclose()

        headers = transport.requests[0].headers
        assert headers["x-tavily-access-mode"] == "keyless"
        assert "authorization" not in headers

    @pytest.mark.asyncio
    async def test_exa_sends_its_own_header_and_asks_only_for_highlights(
        self,
    ) -> None:
        client, transport = client_for(
            {
                "results": [
                    {
                        "title": "Docs",
                        "url": "https://exa.ai/docs",
                        "highlights": ["A short highlight."],
                    }
                ]
            }
        )

        results = await run_provider_search(
            keyed("exa"),
            query="exa search",
            max_results=2,
            recency="any",
            include_domains=[],
            client=client,
        )
        await client.aclose()

        request = transport.requests[0]
        body = cast(dict[str, Any], __import__("json").loads(request.content))
        assert str(request.url) == "https://api.exa.ai/search"
        assert request.headers["x-api-key"] == EXA_KEY
        assert "text" not in body["contents"]
        assert results[0].snippet == "A short highlight."

    @pytest.mark.asyncio
    async def test_domains_are_re_filtered_locally(self) -> None:
        """A provider that ignores the allowlist must not widen what is read."""
        client, _ = client_for(
            tavily_body(
                tavily_hit("https://developer.mozilla.org/en-US/docs/Web/CSS"),
                tavily_hit("https://random-blog.example/css"),
                tavily_hit("https://sub.developer.mozilla.org/page"),
            )
        )

        results = await run_provider_search(
            keyed(),
            query="css grid",
            max_results=5,
            recency="any",
            include_domains=["developer.mozilla.org"],
            client=client,
        )
        await client.aclose()

        assert [result.host for result in results] == [
            "developer.mozilla.org",
            "sub.developer.mozilla.org",
        ]

    @pytest.mark.asyncio
    async def test_non_http_urls_are_dropped(self) -> None:
        client, _ = client_for(
            tavily_body(
                {"title": "Local", "url": "file:///etc/passwd", "content": "x"},
                tavily_hit(),
            )
        )

        results = await run_provider_search(
            keyed(),
            query="css",
            max_results=5,
            recency="any",
            include_domains=[],
            client=client,
        )
        await client.aclose()

        assert [result.url for result in results] == [
            "https://developer.mozilla.org/en-US/docs/Web/CSS"
        ]

    @pytest.mark.asyncio
    async def test_a_redirect_is_reported_rather_than_followed(self) -> None:
        client, _ = client_for(None, status_code=302)

        with pytest.raises(WebSearchError) as error:
            await run_provider_search(
                keyed(),
                query="css",
                max_results=1,
                recency="any",
                include_domains=[],
                client=client,
            )
        await client.aclose()

        assert error.value.code == "provider_error"
        assert "redirect" in error.value.message.lower()


class TestErrorMapping:
    @pytest.mark.parametrize(
        ("status", "code", "hint"),
        [
            (400, "invalid_request", "Narrow the query"),
            (401, "unauthorized", "Check the key"),
            (402, "payment_required", "Top up"),
            (403, "forbidden", "lack access"),
            (429, "rate_limited", "rate limiting"),
            (500, "provider_error", "unexpected response"),
        ],
    )
    @pytest.mark.asyncio
    async def test_http_statuses_map_to_actionable_failures(
        self, status: int, code: str, hint: str
    ) -> None:
        client, _ = client_for({"detail": "provider says no"}, status_code=status)
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert outcome.ok is False
        assert outcome.result["error_code"] == code
        assert hint.lower() in outcome.result["error"].lower()
        assert "provider says no" in outcome.result["error"]

    @pytest.mark.asyncio
    async def test_a_timeout_is_reported_as_one(self) -> None:
        class TimeoutTransport(httpx.AsyncBaseTransport):
            async def handle_async_request(
                self, request: httpx.Request
            ) -> httpx.Response:
                raise httpx.ReadTimeout("too slow", request=request)

        client = httpx.AsyncClient(transport=TimeoutTransport())
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert outcome.result["error_code"] == "timeout"

    @pytest.mark.asyncio
    async def test_a_network_failure_is_reported_as_one(self) -> None:
        class BrokenTransport(httpx.AsyncBaseTransport):
            async def handle_async_request(
                self, request: httpx.Request
            ) -> httpx.Response:
                raise httpx.ConnectError("no route", request=request)

        client = httpx.AsyncClient(transport=BrokenTransport())
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert outcome.result["error_code"] == "network"

    @pytest.mark.asyncio
    async def test_a_non_json_body_is_reported_as_a_provider_error(self) -> None:
        client, _ = client_for(text="<html>maintenance</html>")
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert outcome.result["error_code"] == "provider_error"

    @pytest.mark.asyncio
    async def test_an_unconfigured_runtime_explains_itself(self) -> None:
        runtime = WebSearchRuntime(settings=keyed(api_key=None))

        outcome = await runtime.execute({"query": "css grid"})

        assert outcome.result["error_code"] == "not_configured"
        assert "API key" in outcome.result["error"]


class TestResponseBounding:
    def test_titles_snippets_and_totals_are_capped(self) -> None:
        bounded = bound_results(
            [
                WebSearchResult(
                    title="T" * 500,
                    url="https://example.com/a",
                    snippet="S" * 5_000,
                )
            ]
        )

        assert len(bounded[0]["title"]) <= MAX_TITLE_CHARS
        assert len(bounded[0]["snippet"]) <= MAX_SNIPPET_CHARS

    def test_never_more_than_five_results(self) -> None:
        bounded = bound_results(
            [
                WebSearchResult(
                    title=f"Result {index}",
                    url=f"https://example.com/{index}",
                    snippet="Short.",
                )
                for index in range(12)
            ]
        )

        assert len(bounded) <= MAX_RESULTS

    def test_the_total_character_budget_holds(self) -> None:
        bounded = bound_results(
            [
                WebSearchResult(
                    title="T" * MAX_TITLE_CHARS,
                    url=f"https://example.com/{index}",
                    snippet="S" * MAX_SNIPPET_CHARS,
                )
                for index in range(MAX_RESULTS)
            ]
        )

        total = sum(
            len(entry["title"]) + len(entry["snippet"]) + len(entry["url"])
            for entry in bounded
        )
        assert total <= MAX_TOTAL_CHARS

    @pytest.mark.asyncio
    async def test_a_successful_result_carries_the_untrusted_warning(self) -> None:
        client, _ = client_for(tavily_body(tavily_hit()))
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert outcome.ok is True
        assert outcome.result["warning"] == UNTRUSTED_CONTENT_WARNING
        assert UNTRUSTED_CONTENT_WARNING in outcome.result["content"]
        assert len(outcome.result["results"]) == 1

    @pytest.mark.asyncio
    async def test_strict_mode_nulls_are_clamped_not_refused(self) -> None:
        """OpenAI strict mode sends every optional property, often as null."""
        client, _ = client_for(tavily_body(tavily_hit()))
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute(
            {
                "query": "css grid",
                "max_results": None,
                "recency": None,
                "include_domains": None,
            }
        )
        await client.aclose()

        assert outcome.ok is True
        assert outcome.result["recency"] == "any"

    @pytest.mark.asyncio
    async def test_bad_domain_entries_are_reported_not_silently_dropped(
        self,
    ) -> None:
        client, _ = client_for(tavily_body(tavily_hit()))
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute(
            {
                "query": "css grid",
                "include_domains": [
                    "developer.mozilla.org",
                    "not a domain",
                    "evil.com@good.com",
                ],
            }
        )
        await client.aclose()

        assert outcome.result["include_domains"] == ["developer.mozilla.org"]
        assert any("Ignored entries" in note for note in outcome.result["notes"])


class TestBudgets:
    def test_defaults_match_the_documented_ceilings(self) -> None:
        budget = WebSearchBudget()

        assert budget.per_turn == MAX_SEARCHES_PER_TURN == 3
        assert budget.per_generation == MAX_SEARCHES_PER_GENERATION == 10

    @pytest.mark.asyncio
    async def test_a_turn_is_capped_and_resets_on_the_next_turn(self) -> None:
        client, transport = client_for(tavily_body(tavily_hit()))
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcomes = [
            await runtime.execute({"query": f"query {index}"}) for index in range(4)
        ]

        assert [outcome.ok for outcome in outcomes] == [True, True, True, False]
        assert outcomes[3].result["error_code"] == "budget_exhausted"
        assert len(transport.requests) == MAX_SEARCHES_PER_TURN

        runtime.start_turn()
        assert (await runtime.execute({"query": "after reset"})).ok is True
        await client.aclose()

    @pytest.mark.asyncio
    async def test_the_generation_ceiling_survives_turn_resets(self) -> None:
        client, transport = client_for(tavily_body(tavily_hit()))
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        for _ in range(6):
            runtime.start_turn()
            for _ in range(MAX_SEARCHES_PER_TURN):
                await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert len(transport.requests) == MAX_SEARCHES_PER_GENERATION
        assert runtime.budget.generation_remaining == 0

    @pytest.mark.asyncio
    async def test_a_failed_search_still_spends_its_allowance(self) -> None:
        """A request that left the machine counts, successful or not."""
        client, _ = client_for({"detail": "nope"}, status_code=429)
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert runtime.budget.used_this_generation == 1

    @pytest.mark.asyncio
    async def test_a_query_that_is_too_short_costs_nothing(self) -> None:
        runtime = WebSearchRuntime(settings=keyed())

        outcome = await runtime.execute({"query": "a"})

        assert outcome.result["error_code"] == "invalid_request"
        assert runtime.budget.used_this_generation == 0

    @pytest.mark.asyncio
    async def test_remaining_counts_are_reported_back_to_the_model(self) -> None:
        client, _ = client_for(tavily_body(tavily_hit()))
        runtime = WebSearchRuntime(settings=keyed(), client=client)

        outcome = await runtime.execute({"query": "css grid"})
        await client.aclose()

        assert outcome.result["searches_remaining_this_turn"] == 2
        assert outcome.result["searches_remaining_this_generation"] == 9


class TestAgentRuntimeDispatch:
    @pytest.mark.asyncio
    async def test_the_tool_runs_through_the_agent_runtime(self) -> None:
        client, _ = client_for(tavily_body(tavily_hit()))
        runtime = AgentToolRuntime(
            file_state=AgentFileState(),
            should_generate_images=False,
            openai_api_key=None,
            openai_base_url=None,
            web_search=WebSearchRuntime(settings=keyed(), client=client),
        )

        result = await runtime.execute(
            ToolCall(id="1", name=WEB_SEARCH_TOOL_NAME, arguments={"query": "css grid"})
        )
        await client.aclose()

        assert result.ok is True
        assert result.summary["count"] == 1

    @pytest.mark.asyncio
    async def test_calling_it_without_a_runtime_explains_itself(self) -> None:
        runtime = AgentToolRuntime(
            file_state=AgentFileState(),
            should_generate_images=False,
            openai_api_key=None,
            openai_base_url=None,
        )

        result = await runtime.execute(
            ToolCall(id="1", name=WEB_SEARCH_TOOL_NAME, arguments={"query": "css"})
        )

        assert result.ok is False
        assert result.result["error_code"] == "not_configured"


class TestRoutes:
    """The Settings dialog's two questions, answered without a generation."""

    def client(self) -> "TestClient":
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from routes import web_search as route

        app = FastAPI()
        app.include_router(route.router)
        return TestClient(app)

    def test_validate_reports_an_off_configuration_without_failing(self) -> None:
        payload = self.client().post(
            "/api/web-search/validate", json={"webSearch": {"enabled": False}}
        ).json()

        assert payload["valid"] is True
        assert payload["usable"] is False
        assert payload["webSearch"]["reason"] == "Web search is switched off."

    def test_validate_never_echoes_the_key(self) -> None:
        response = self.client().post(
            "/api/web-search/validate",
            json={"webSearch": {"enabled": True, "apiKey": TAVILY_KEY}},
        )

        assert TAVILY_KEY not in response.text
        assert response.json()["webSearch"]["hasApiKey"] is True

    def test_validate_refuses_an_unknown_provider_with_a_sentence(self) -> None:
        payload = self.client().post(
            "/api/web-search/validate",
            json={"webSearch": {"enabled": True, "provider": "brave"}},
        ).json()

        assert payload["valid"] is False
        assert "tavily" in payload["error"]

    def test_validate_contacts_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A key can be checked while it is still being typed."""

        async def fail(*_args: object, **_kwargs: object) -> list[WebSearchResult]:
            raise AssertionError("validate must not call the provider")

        monkeypatch.setattr("routes.web_search.run_provider_search", fail)

        assert (
            self.client()
            .post(
                "/api/web-search/validate",
                json={"webSearch": {"enabled": True, "apiKey": TAVILY_KEY}},
            )
            .json()["usable"]
            is True
        )

    def test_test_connection_runs_one_real_search(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[dict[str, Any]] = []

        async def fake(settings: Any, **kwargs: Any) -> list[WebSearchResult]:
            calls.append(kwargs)
            return [
                WebSearchResult(title="T", url="https://example.com", snippet="S")
            ]

        monkeypatch.setattr("routes.web_search.run_provider_search", fake)

        payload = self.client().post(
            "/api/web-search/test",
            json={"webSearch": {"enabled": True, "apiKey": TAVILY_KEY}},
        ).json()

        assert payload == {
            "ok": True,
            "error": None,
            "errorCode": None,
            "provider": "tavily",
            "providerLabel": "Tavily",
            "accessMode": "api-key",
            "resultCount": 1,
        }
        assert len(calls) == 1
        assert calls[0]["max_results"] == 1
        assert calls[0]["include_domains"] == []

    def test_test_connection_reports_the_providers_own_problem(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fail(*_args: object, **_kwargs: object) -> list[WebSearchResult]:
            raise WebSearchError("unauthorized", "Tavily rejected the API key.")

        monkeypatch.setattr("routes.web_search.run_provider_search", fail)

        payload = self.client().post(
            "/api/web-search/test",
            json={"webSearch": {"enabled": True, "apiKey": TAVILY_KEY}},
        ).json()

        assert payload["ok"] is False
        assert payload["errorCode"] == "unauthorized"

    def test_test_connection_refuses_an_unusable_configuration_without_calling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fail(*_args: object, **_kwargs: object) -> list[WebSearchResult]:
            raise AssertionError("must not call the provider")

        monkeypatch.setattr("routes.web_search.run_provider_search", fail)
        monkeypatch.setattr("routes.web_search.TAVILY_API_KEY", None)

        payload = self.client().post(
            "/api/web-search/test", json={"webSearch": {"enabled": True}}
        ).json()

        assert payload["errorCode"] == "not_configured"
