# Screen Mark 영역 캡처 성능 기록

측정일: 2026-10-29 KST. Chrome/155.0.8059.86. 설치된 Chrome의 별도 headless 프로필과 동일한 로컬 예제를 사용함. 원시 결과에서 이 문서의 수치를 자동 계산함.

## 초기 측정 보존

v1.2.2의 최초 3회 측정에서 선택 준비 중앙값은 899.0ms, 마우스를 놓은 뒤 편집기 표시 중앙값은 630.6ms였음. Node·CDP 왕복과 자동화 도구의 대기까지 포함한 값임. 제품 내부 지연으로 그대로 해석하거나 아래 측정과 개선율을 계산하지 않음. [초기 원본](performance/v1.2.2-region-initial.json).

## 브라우저 내부 구간 측정

v1.2.2를 3회 측정함. 선택 시작은 브라우저 내부 sendMessage 왕복, 편집 표시 구간은 원래 페이지의 요청 시작과 편집기의 두 번째 애니메이션 프레임 시각 차이임. 서로 다른 페이지의 performance.timeOrigin과 performance.now를 합한 시각을 사용함. 촬영·인코딩·DB는 각 API 구간으로, 병행되거나 서로 겹칠 수 있어 합산하지 않음. 표는 실행별 중앙값임.

| 항목 | v1.2.2 |
|---|---:|
| 선택 시작 요청 | 20.9 ms |
| 마우스 놓기부터 편집 화면 그리기 | 393.2 ms |
| 선택 완료 요청 응답 | 262.0 ms |
| 촬영 API | 33.2 ms |
| 이미지 디코딩 | 4.8 ms |
| 선택 부분 PNG 인코딩 | 43.6 ms |
| DB 열기 합계 | 78.4 ms |
| DB 트랜잭션 합계 | 11.6 ms |
| 편집 탭 생성 API | 50.4 ms |
| 드래그 입력 120회 처리 합계 | 2.9 ms |

실제 pointerdown의 ID를 재사용한 합성 pointermove 입력 120개를 30개 프레임에 전달함. 마지막 실제 마우스 이동 전에 선택 상자가 300 × 200px로 갱신됐는지 단언함. 물리적 마우스 입력 지연을 측정한 결과는 아님. 드래그 구간에서 관측된 50ms 이상 작업은 기준선 0회였음.

소스 SHA-256: 기준선 `99b98bb39afdec56608136794c6653f14413672d74ccfaba6df5c951f2215295`. [기준선 원본](performance/v1.2.2-region-profile.json).

## 큰 이미지 편집·복사

v1.2.0 커밋 `dbb4050622c546227b400bb355b53731ce7f049b`와 v1.2.2를 교대로 각각 3회 측정함. 1600 × 10000px 동일 이미지와 실제 클립보드 쓰기를 사용함. v1.2.2의 첫 복사 중앙값은 329.6ms, 수정 없는 반복 복사는 162.9ms임. 양쪽 모두 120회 입력에서 재그리기 30회, 반복 복사의 PNG 재생성 0회를 확인함. 실행 간 변동과 겹치는 범위가 있고 편집·렌더 소스가 같으므로 리팩터링에 따른 속도 변화로 단정하지 않음. [비교 원본](performance/v1.2.0-v1.2.2-editor.json).

## 확인한 개선 후보와 제약

- 촬영·자르기가 끝난 뒤 DB 정리를 시작하는 순서가 첫 DB 열기 시간을 그대로 더함. 동일한 만료 기준·쓰기 잠금으로 정리하되 촬영과 겹쳐 실행하는 방법을 시험함. 양쪽 작업이 끝난 뒤에만 저장하고 실패를 전달해야 함.
- 선택 검증에 전체 UI 함수를 다시 전달하는 비용은 세부 계측에서 작았으므로 우선순위를 낮춤. 드래그 입력 처리도 낮은 비용을 보였으므로 현재 단계에서 새 그리기 구조를 추가하지 않음.
- 촬영 호출 제한은 유지함. Chrome은 captureVisibleTab을 초당 최대 2회로 제한함. [Chrome Tabs 공식 문서](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND).
- executeScript는 주입 함수를 직렬화하며 기본적으로 document_idle에 실행함. 로딩 중 페이지에는 injectImmediately도 후보지만 현재 로드된 예제 결과와 별도로 검증해야 함. [Chrome Scripting 공식 문서](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ScriptInjection).
- 사용자 프로필의 도구 모음 팝업 생성 시간, 모든 웹사이트, 장시간 연속 사용은 이번 측정에 포함하지 않음. 소수 표본의 중앙값은 통계적으로 확정된 개선율을 뜻하지 않음.

## 재현

영역 측정: `node scripts/benchmark-region.mjs`. BENCH_TRIALS, BENCH_OUTPUT, BENCH_EXTENSION으로 반복 수·출력·소스를 지정함. 보고서 재생성: `node scripts/region-performance-report.mjs`.
