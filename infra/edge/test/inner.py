"""compose 망 안에서 URL을 N번 불러 실패한 횟수를 출력한다(infra/edge/test). 목 컨테이너 안에서 돈다.

사용: python inner.py <URL> <횟수>
"""
import sys
import urllib.request

url, count = sys.argv[1], int(sys.argv[2])
failures = 0
for _ in range(count):
    try:
        urllib.request.urlopen(url, timeout=3).read()
    except Exception:
        failures += 1
print(failures)
