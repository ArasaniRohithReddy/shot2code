import pytest

from prompts.system_prompt import SYSTEM_PROMPT
from tests.stack_acceptance_fixtures import (
    INVALID_LEGACY_RUNTIME_MARKERS,
    STACK_ACCEPTANCE_CASES,
    StackAcceptanceCase,
)


def prompt_section(heading: str) -> str:
    marker = f"## {heading}"
    start = SYSTEM_PROMPT.index(marker)
    end = SYSTEM_PROMPT.find("\n## ", start + len(marker))
    return SYSTEM_PROMPT[start:] if end < 0 else SYSTEM_PROMPT[start:end]


@pytest.mark.parametrize("acceptance", STACK_ACCEPTANCE_CASES, ids=lambda case: case.stack)
def test_stack_prompt_runtime_matrix(acceptance: StackAcceptanceCase) -> None:
    section = prompt_section(acceptance.prompt_heading)

    for marker in acceptance.prompt_required:
        assert marker in section
    for marker in acceptance.prompt_forbidden:
        assert marker not in section


def test_generation_prompt_contains_no_invalid_legacy_runtime_urls() -> None:
    for marker in INVALID_LEGACY_RUNTIME_MARKERS:
        assert marker not in SYSTEM_PROMPT
