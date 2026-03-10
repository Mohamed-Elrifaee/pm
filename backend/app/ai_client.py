import json
import os
from typing import Any
import urllib.error
import urllib.request

OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OPENROUTER_MODEL = "openrouter/free"
DEFAULT_TIMEOUT_SECONDS = 20.0


class AIClientError(Exception):
    pass


class AIClientConfigError(AIClientError):
    pass


class AIClientUpstreamError(AIClientError):
    pass


def request_chat_completion(prompt: str) -> str:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise AIClientConfigError("OPENROUTER_API_KEY is not configured.")

    configured_model = os.environ.get("OPENROUTER_MODEL", "").strip()
    model = configured_model or DEFAULT_OPENROUTER_MODEL

    configured_timeout = os.environ.get("OPENROUTER_TIMEOUT_SECONDS", "").strip()
    timeout_seconds = DEFAULT_TIMEOUT_SECONDS
    if configured_timeout:
        try:
            timeout_seconds = float(configured_timeout)
        except ValueError as error:
            raise AIClientConfigError("OPENROUTER_TIMEOUT_SECONDS must be a number.") from error

    payload_dict: dict[str, Any] = {
        "model": model,
        "temperature": 0,
        "messages": [{"role": "user", "content": prompt}],
    }
    payload_bytes = json.dumps(payload_dict).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    request = urllib.request.Request(
        OPENROUTER_CHAT_COMPLETIONS_URL,
        data=payload_bytes,
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            status_code = response.getcode()
            raw_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        raise AIClientUpstreamError(
            f"OpenRouter request failed with status {error.code}."
        ) from error
    except urllib.error.URLError as error:
        raise AIClientUpstreamError("Failed to reach OpenRouter.") from error

    if status_code >= 400:
        raise AIClientUpstreamError(
            f"OpenRouter request failed with status {status_code}."
        )

    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError as error:
        raise AIClientUpstreamError("OpenRouter returned non-JSON output.") from error

    content = _extract_message_content(body)
    if not content:
        raise AIClientUpstreamError("OpenRouter returned an empty message.")

    return content


def _extract_message_content(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise AIClientUpstreamError("OpenRouter response is missing choices.")

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise AIClientUpstreamError("OpenRouter response choice is invalid.")

    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise AIClientUpstreamError("OpenRouter response message is invalid.")

    content = message.get("content")
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        text_parts = [
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        return "".join(text_parts).strip()

    raise AIClientUpstreamError("OpenRouter response content is invalid.")
