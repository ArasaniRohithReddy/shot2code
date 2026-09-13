"""Pydantic request and response models for project history."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Identifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=512),
]


def _empty_json_object() -> dict[str, Any]:
    return {}


def _empty_media() -> list[dict[str, Any]]:
    return []


def _empty_messages() -> list[HistoryMessageInput]:
    return []


def _empty_prompts() -> list[PromptInput]:
    return []


def _empty_variants() -> list[VariantInput]:
    return []


class HistoryApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HistoryMessageInput(HistoryApiModel):
    id: str | None = Field(default=None, min_length=1, max_length=512)
    role: str = Field(min_length=1, max_length=500)
    content: str | None = None
    media: list[dict[str, Any]] = Field(default_factory=_empty_media)
    metadata: dict[str, Any] = Field(default_factory=_empty_json_object)
    created_at: AwareDatetime | None = None


class PromptInput(HistoryApiModel):
    id: str | None = Field(default=None, min_length=1, max_length=512)
    role: str = Field(default="user", min_length=1, max_length=500)
    kind: str = Field(default="generation", min_length=1, max_length=500)
    content: Any
    metadata: dict[str, Any] = Field(default_factory=_empty_json_object)
    created_at: AwareDatetime | None = None


class VariantInput(HistoryApiModel):
    index: int = Field(ge=0)
    model: str | None = Field(default=None, max_length=500)
    status: str = Field(default="completed", min_length=1, max_length=500)
    code: str | None = None
    current_content: str | None = None
    created_at: AwareDatetime | None = None
    started_at: AwareDatetime | None = None
    completed_at: AwareDatetime | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=_empty_json_object)
    messages: list[HistoryMessageInput] = Field(default_factory=_empty_messages)


class VersionInput(HistoryApiModel):
    id: Identifier
    commit_hash: str | None = Field(default=None, max_length=500)
    parent_commit_id: str | None = Field(default=None, min_length=1, max_length=512)
    retry_of_commit_id: str | None = Field(default=None, min_length=1, max_length=512)
    version_type: str = Field(default="create", min_length=1, max_length=500)
    inputs: dict[str, Any] = Field(default_factory=_empty_json_object)
    prompt_metadata: dict[str, Any] = Field(default_factory=_empty_json_object)
    metadata: dict[str, Any] = Field(default_factory=_empty_json_object)
    created_at: AwareDatetime | None = None
    prompts: list[PromptInput] = Field(default_factory=_empty_prompts)
    variants: list[VariantInput] = Field(default_factory=_empty_variants)

    @field_validator("version_type")
    @classmethod
    def normalize_version_type(cls, value: str) -> str:
        return value.lower()

    @model_validator(mode="after")
    def validate_version(self) -> "VersionInput":
        if self.version_type == "retry" and self.retry_of_commit_id is None:
            raise ValueError("retry versions require retryOfCommitId")

        variant_indexes = [variant.index for variant in self.variants]
        if len(variant_indexes) != len(set(variant_indexes)):
            raise ValueError("variant indexes must be unique within a version")

        prompt_ids = [prompt.id for prompt in self.prompts if prompt.id is not None]
        if len(prompt_ids) != len(set(prompt_ids)):
            raise ValueError("prompt ids must be unique within a version")

        for variant in self.variants:
            message_ids = [
                message.id for message in variant.messages if message.id is not None
            ]
            if len(message_ids) != len(set(message_ids)):
                raise ValueError("message ids must be unique within a variant")
        return self


class AppendVersionRequest(HistoryApiModel):
    version: VersionInput
    set_as_head: bool = True
    select_commit: bool = True
    selected_variant_index: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_selection(self) -> "AppendVersionRequest":
        if not self.select_commit and self.selected_variant_index is not None:
            raise ValueError("selectedVariantIndex requires selectCommit")
        return self


class ProjectSnapshotRequest(HistoryApiModel):
    title: str = Field(min_length=1, max_length=500)
    stack: str | None = Field(default=None, max_length=500)
    input_mode: str | None = Field(default=None, max_length=500)
    metadata: dict[str, Any] = Field(default_factory=_empty_json_object)
    created_at: AwareDatetime | None = None
    version: VersionInput | None = None
    set_as_head: bool = True
    select_commit: bool = True
    selected_variant_index: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_selection(self) -> "ProjectSnapshotRequest":
        if self.version is None and self.selected_variant_index is not None:
            raise ValueError("selectedVariantIndex requires a version")
        if not self.select_commit and self.selected_variant_index is not None:
            raise ValueError("selectedVariantIndex requires selectCommit")
        return self


class SelectionUpdateRequest(HistoryApiModel):
    head_commit_id: str | None = Field(default=None, min_length=1, max_length=512)
    selected_commit_id: str | None = Field(default=None, min_length=1, max_length=512)
    selected_variant_index: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def require_update(self) -> "SelectionUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one selection field is required")
        return self


class HistoryMessageRecord(HistoryApiModel):
    id: str
    position: int
    role: str
    content: str | None
    media: list[Any]
    metadata: dict[str, Any]
    created_at: datetime


class PromptRecord(HistoryApiModel):
    id: str
    position: int
    role: str
    kind: str
    content: Any
    metadata: dict[str, Any]
    created_at: datetime


class VariantRecord(HistoryApiModel):
    index: int
    model: str | None
    status: str
    code: str | None
    current_content: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    duration_ms: int | None
    error: str | None
    metadata: dict[str, Any]
    messages: list[HistoryMessageRecord]


class CommitRecord(HistoryApiModel):
    id: str
    commit_hash: str | None
    parent_commit_id: str | None
    retry_of_commit_id: str | None
    version_type: str
    inputs: dict[str, Any]
    prompt_metadata: dict[str, Any]
    metadata: dict[str, Any]
    created_at: datetime
    prompts: list[PromptRecord]
    variants: list[VariantRecord]
    child_commit_ids: list[str]


class ProjectSummary(HistoryApiModel):
    id: str
    title: str
    stack: str | None
    input_mode: str | None
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    head_commit_id: str | None
    selected_commit_id: str | None
    selected_variant_index: int | None
    commit_count: int
    variant_count: int


class ProjectHistory(ProjectSummary):
    root_commit_ids: list[str]
    commits: list[CommitRecord]


class ProjectListResponse(HistoryApiModel):
    projects: list[ProjectSummary]


class MigrationRecord(HistoryApiModel):
    version: int
    name: str
    applied_at: datetime


class HistoryHealthResponse(HistoryApiModel):
    status: str
    database_path: str
    schema_version: int
    latest_schema_version: int
    foreign_keys_enabled: bool
    journal_mode: str
    migrations: list[MigrationRecord]
