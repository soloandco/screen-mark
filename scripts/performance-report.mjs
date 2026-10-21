import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = path.resolve(process.argv[2] || 'test-results/performance/raw.json');
const destination = path.resolve(process.argv[3] || 'docs/performance.md');
const data = JSON.parse(await readFile(input, 'utf8'));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
assert.equal(data.runs.length, data.environment.trials * 2, 'comparison must include every planned run');
assert.ok(data.runs.every(run => run.ok && !run.error), 'comparison contains a failed run');
for (const label of ['before', 'after']) assert.equal(data.runs.filter(run => run.label === label).length, data.environment.trials);
const rows = [
  ['현재 화면 캡처 요청 완료', run => run.captureRequestMs, 'ms'],
  ['캡처 요청부터 편집 화면 표시', run => run.editorReadyMs, 'ms'],
  ['드래그 구간 메인 스레드 작업', run => run.drag.mainThreadTaskMs, 'ms'],
  ['드래그 구간 전체 경과', run => run.drag.elapsedMs, 'ms'],
  ['드래그 중 재그리기 횟수', run => run.drag.redraws, '회'],
  ['첫 클립보드 복사', run => run.firstCopy.copyMs, 'ms'],
  ['수정 없는 반복 클립보드 복사', run => median(run.repeatCopies.map(item => item.copyMs)), 'ms'],
  ['첫 복사 PNG 생성 횟수', run => run.firstCopy.encodes, '회'],
  ['반복 복사 PNG 생성 횟수', run => median(run.repeatCopies.map(item => item.encodes)), '회']
];
if (data.runs.every(run => run.memory.length)) {
  rows.push(['작업 중 관측된 최대 브라우저 메모리', run => Math.max(...run.memory.map(item => item.privateWorkingSetBytes)) / 1048576, 'MiB']);
  rows.push(['복사 후 브라우저 메모리', run => run.memory.findLast(item => item.stage === 'after-copy-idle').privateWorkingSetBytes / 1048576, 'MiB']);
}
const summaries = rows.map(([name, measure, unit]) => {
  const groups = ['before', 'after'].map(label => data.runs.filter(run => run.label === label).map(measure));
  assert.ok(groups.flat().every(Number.isFinite), `Missing measurement: ${name}`);
  const [before, after] = groups.map(median);
  return { name, unit, before, after, change: before ? (after / before - 1) * 100 : null, ranges: groups.map(values => [Math.min(...values), Math.max(...values)]) };
});
const format = (value, unit) => `${value.toFixed(unit === '회' ? 0 : 1)} ${unit}`;
const table = summaries.map(item => `| ${item.name} | ${format(item.before, item.unit)} | ${format(item.after, item.unit)} | ${item.change === null ? '기준값 0' : `${item.change > 0 ? '+' : ''}${item.change.toFixed(1)}%`} |`).join('\n');
const ranges = summaries.filter(item => item.unit !== '회').map(item => `| ${item.name} | ${item.ranges[0].map(value => value.toFixed(1)).join('~')} | ${item.ranges[1].map(value => value.toFixed(1)).join('~')} |`).join('\n');
const rawLink = path.relative(path.dirname(destination), input).replaceAll('\\', '/');
const markdown = `# Screen Mark v1.0.2 성능 비교

측정일: ${data.date} (KST). 비교 대상: v1.0.1 공개 소스 ${data.baselineSha} 및 v1.0.2. 이 문서의 수치는 [원시 측정 결과](${rawLink})에서 자동 계산했다.

## 측정 조건

- ${data.environment.chrome.product}, ${data.environment.os}, ${data.environment.cpu.trim()}.
- 설치된 Google Chrome의 headless 모드에 실제 확장을 로드했다. 매번 새 시험용 프로필을 만들었으며 사용자 프로필은 열지 않았다.
- 버전별 ${data.environment.trials}회, 실행 순서는 전/후와 후/전을 교대했다. 아래 값은 실행별 결과의 중앙값이다.
- 현재 화면은 ${data.environment.viewport.width} × ${data.environment.viewport.height}px의 동일한 로컬 예제 페이지를 캡처했다. 최초 GPU·인코더 초기화 영향을 줄이기 위해 직접 캡처 한 번을 먼저 실행했다. 확장 팝업을 여는 시간과 브라우저 최초 실행 시간은 포함하지 않는다.
- 편집은 동일한 ${data.environment.longImage.width} × ${data.environment.longImage.height}px 이미지에 사각형과 번호를 추가했다. 실제 클립보드 이미지 쓰기를 실행했으며 쓰기 API를 가짜로 대체하지 않았다.
- 복사 시간은 버튼의 클릭 이벤트부터 실제 클립보드 쓰기 완료까지다. PNG 합성·인코딩 시간을 포함한다. 반복 복사는 수정 없이 세 번 실행한 중앙값을 먼저 구했다.

## 결과

변화율은 (변경 후 / 변경 전 - 1)이다. 음수는 감소, 양수는 증가를 뜻한다.

| 항목 | 변경 전 | 변경 후 | 변화율 |
|---|---:|---:|---:|
${table}

### 실행별 최솟값과 최댓값

시간은 ms, 메모리는 MiB다. 실행별 변동을 보여주며 신뢰구간을 뜻하지 않는다.

| 항목 | 변경 전 범위 | 변경 후 범위 |
|---|---:|---:|
${ranges}

## 해석 범위

- 드래그 작업은 30개 화면 프레임 동안 프레임당 4개씩, 총 120개의 합성 pointermove 이벤트를 전달했다. 재그리기 요청을 묶는 효과를 재현하는 부하 검사이며, 모든 마우스와 사이트에서 같은 배율로 빨라진다는 뜻은 아니다.
- 메인 스레드 작업 시간은 해당 편집 탭의 CDP Performance.TaskDuration 차이다. 다음 프레임으로 옮긴 그리기 작업도 포함한다. GPU 전체 사용 시간은 아니다. 원시 데이터에는 이벤트 처리 시간과 프레임 간격도 남겼다.
- 메모리는 Windows GetProcessMemoryInfo의 PrivateWorkingSetSize를 시험용 Chrome 프로세스 전체에 대해 합산한 값이다. 브라우저·렌더러·GPU 등을 포함하므로 확장 단독 메모리와 다르다. 약 100ms 간격의 관측 최댓값이며 순간 최고점을 놓칠 수 있다.
- 복사 후 메모리는 마지막 복사가 끝난 뒤 300ms 대기하고 읽었다. 강제 가비지 컬렉션은 실행하지 않았으므로 장시간 대기 후의 최소 메모리를 뜻하지 않는다. 프로세스 종료 절차는 모든 측정이 끝난 뒤 실행한다.
- PNG 캐시는 최근 결과 한 개, 16MiB 이하로 제한된다. 첫 복사는 여전히 합성·인코딩이 필요하며, 이미지를 수정하면 다음 복사는 새 결과를 생성한다.
- 이 결과는 이 PC·Chrome·예제 이미지 조건에 한정된다. Awesome Screenshot 등 다른 제품과의 비교 결과는 아니다.

## 재현

Node.js 22 이상, npm 의존성, 설치된 Google Chrome이 필요하다. Windows에서 메모리도 측정하려면 Python 3를 설치한다.

\`\`\`sh
npm ci
npm run benchmark
node scripts/performance-report.mjs test-results/performance/raw.json docs/performance.md
\`\`\`

환경변수 BENCH_BASELINE, BENCH_TRIALS, BENCH_OUTPUT, BENCH_PYTHON으로 기준 커밋·반복 수·출력 폴더·Python 경로를 지정할 수 있다. 기본 기준 커밋은 d5aed23, 반복 수는 버전별 5회다. 공개 원시 결과를 그대로 검산하려면 이 문서의 원시 결과 파일을 첫 번째 인자로 전달한다.
`;
await writeFile(destination, markdown);
console.log(JSON.stringify({ destination, summaries }, null, 2));
