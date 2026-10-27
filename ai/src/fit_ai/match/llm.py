"""LLM 호출 인터페이스. 요청 해석과 정렬은 이 인터페이스만 보고 테스트는 가짜를 쓴다.

실제 호출은 공유 모듈 `fit_ai.gms`가 맡는다. 접속 설정(`GMS_ENABLED`, `GMS_BASE_URL`,
`GMS_API_KEY`), 킬스위치, 원문 로그 금지, 한 번 다시 요청하기가 거기 있다. 응답 내용
검사는 요청 해석과 정렬이 각자 한다.
"""

import json
import os
from typing import Protocol

import httpx

from fit_ai import gms


class LlmError(Exception):
    """LLM 호출이 실패했다. 타임아웃, 네트워크 오류, 킬스위치가 꺼진 경우다."""


class LlmClient(Protocol):
    """JSON으로 답하는 LLM."""

    def complete_json(self, system: str, user: str) -> str:
        """지시와 입력을 보내고 응답 본문을 받는다.

        Args:
            system: 시스템 지시
            user: 사용자 입력

        Returns:
            응답 본문. JSON이어야 하지만 검사는 부르는 쪽이 한다.

        Raises:
            LlmError: 호출이 실패했을 때
        """
        ...


class GmsLlm:
    """공유 모듈 `fit_ai.gms`로 GMS를 부른다.

    호출 실패와 JSON이 아닌 응답은 공유 모듈이 한 번 다시 요청한다. 내용 검사는
    부르는 쪽(요청 해석, 정렬)이 하고, 내용이 틀리면 다시 요청하지 않고 규칙이나
    유사도로 넘어간다.

    Attributes:
        model: GMS 모델 이름. 응답의 `models.llm`에 싣는다.
    """

    model = gms.MODEL

    def __init__(
        self, timeout_seconds: float = 5.0, client: httpx.Client | None = None
    ) -> None:
        """GMS 호출 설정을 정한다.

        Args:
            timeout_seconds: 한 번 부를 때 응답을 기다리는 시간(초). 공유 모듈은
                실패하면 한 번 더 부르므로 가장 오래 걸리면 이 시간의 두 배다.
            client: HTTP 클라이언트. 연결을 다시 쓰려고 넘긴다. 없으면 부를 때마다 만든다.
        """
        self._timeout = timeout_seconds
        self._client = client

    @property
    def enabled(self) -> bool:
        """킬스위치(`GMS_ENABLED`)가 켜져 있는지"""
        return os.environ.get("GMS_ENABLED") == "true"

    def complete_json(self, system: str, user: str) -> str:
        """지시와 입력을 보내고 JSON 응답 본문을 받는다.

        Args:
            system: 시스템 지시. GMS 안내처럼 developer 역할로 보낸다.
            user: 사용자 입력

        Returns:
            모델이 낸 JSON 문자열

        Raises:
            LlmError: 꺼져 있거나 두 번 모두 실패했을 때
        """
        result = gms.call_json(
            [
                {"role": "developer", "content": system},
                {"role": "user", "content": user},
            ],
            lambda data: data,
            timeout=self._timeout,
            client=self._client,
        )
        if result is None:
            raise LlmError("GMS가 꺼져 있거나 두 번 모두 실패했다")
        return json.dumps(result, ensure_ascii=False)


def strip_json_fence(raw: str) -> str:
    """```json 으로 감싼 출력에서 감싼 부분을 벗긴다.

    Args:
        raw: LLM 응답 본문

    Returns:
        감싼 부분을 벗긴 본문. 감싸지 않았으면 앞뒤 공백만 지운다.
    """
    text = raw.strip()
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```")
    return text
