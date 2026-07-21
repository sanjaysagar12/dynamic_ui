import json

import anthropic
from anthropic import Anthropic

from app.schemas import ArtifactSpec, ChatMessage
from app.services.providers.base import (
    ARTIFACT_JSON_SCHEMA,
    GET_SCHEMA_TOOL_DESCRIPTION,
    GET_SCHEMA_TOOL_NAME,
    ArtifactGenerationError,
    ArtifactLLMClient,
    build_system_prompt,
    format_schema_for_tool_result,
)
from app.services.tool_client import ToolServiceClient, ToolServiceError

_GET_SCHEMA_TOOL = {
    "name": GET_SCHEMA_TOOL_NAME,
    "description": GET_SCHEMA_TOOL_DESCRIPTION,
    "input_schema": {"type": "object", "properties": {}, "required": []},
}

_MAX_TOOL_ITERATIONS = 3


class ClaudeArtifactGenerator(ArtifactLLMClient):
    def __init__(self, model: str, tool_client: ToolServiceClient) -> None:
        self._model = model
        self._client = Anthropic()
        self._tool_client = tool_client

    def generate(self, messages: list[ChatMessage], context_files: dict[str, str] | None) -> ArtifactSpec:
        system_prompt = build_system_prompt(context_files)
        running_messages: list[dict] = [{"role": m.role, "content": m.content} for m in messages]

        try:
            running_messages = self._run_tool_loop(system_prompt, running_messages)

            with self._client.messages.stream(
                model=self._model,
                max_tokens=8000,
                thinking={"type": "adaptive"},
                system=system_prompt,
                messages=running_messages,
                output_config={"format": {"type": "json_schema", "schema": ARTIFACT_JSON_SCHEMA}},
            ) as stream:
                response = stream.get_final_message()
        except TypeError as exc:
            # Raised by the SDK when no credentials resolve (no API key / auth token / profile).
            raise ArtifactGenerationError(f"Anthropic client misconfigured: {exc}") from exc
        except anthropic.APIError as exc:
            raise ArtifactGenerationError(f"Claude request failed: {exc}") from exc

        if response.stop_reason == "refusal":
            raise ArtifactGenerationError("Claude declined to generate this artifact")

        text_blocks = [block.text for block in response.content if block.type == "text"]
        if not text_blocks:
            raise ArtifactGenerationError(f"Claude returned no text output (stop_reason={response.stop_reason})")

        try:
            data = json.loads("".join(text_blocks))
            return ArtifactSpec.model_validate(data)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ArtifactGenerationError(f"Claude returned an invalid artifact spec: {exc}") from exc

    def _run_tool_loop(self, system_prompt: str, running_messages: list[dict]) -> list[dict]:
        for _ in range(_MAX_TOOL_ITERATIONS):
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=system_prompt,
                messages=running_messages,
                tools=[_GET_SCHEMA_TOOL],
            )

            if response.stop_reason != "tool_use":
                break

            assistant_content = []
            for block in response.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
            running_messages.append({"role": "assistant", "content": assistant_content})

            tool_result_content = []
            for block in assistant_content:
                if block["type"] != "tool_use":
                    continue
                result_text = self._execute_tool(block["name"])
                tool_result_content.append({"type": "tool_result", "tool_use_id": block["id"], "content": result_text})
            running_messages.append({"role": "user", "content": tool_result_content})

        return running_messages

    def _execute_tool(self, name: str) -> str:
        if name != GET_SCHEMA_TOOL_NAME:
            return f"Unknown tool: {name}"
        try:
            tables = self._tool_client.get_schema()
            return format_schema_for_tool_result(tables)
        except ToolServiceError as exc:
            return f"Schema lookup failed: {exc}. Proceed without relying on exact table/column names."
