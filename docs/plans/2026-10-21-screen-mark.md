# Screen Mark Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 개인용 캡처 확장에 사각형과 원형 번호 라벨을 표시하고 합성 이미지를 저장한다.

**Architecture:** MV3 service worker가 현재 탭을 캡처하고 IndexedDB로 편집기에 전달한다. 편집기는 원본 이미지와 불변 주석 모델을 Canvas에서 합성하며 undo/redo 이력을 관리한다.

**Tech Stack:** JavaScript modules, Chrome Extensions API, Canvas, IndexedDB, Node test runner, Playwright for isolated extension testing.

## Task 1: 모델과 테스트

파일: `extension/model.js`, `tests/model.test.js`, `package.json`.

1. 역방향 사각형, 좌표 스케일, 자동 번호와 undo/redo, 이동, crop에 대한 실패 테스트 작성.
2. `node --test tests/model.test.js`로 실패 확인.
3. 순수 함수와 이력 객체 구현 후 같은 테스트 통과.

## Task 2: 확장 캡처

파일: `extension/manifest.json`, `extension/background.js`, `extension/page-capture.js`, `extension/storage.js`, `extension/popup.html`, `extension/popup.js`, `extension/popup.css`.

1. Chrome 공식 API 시그니처 확인: captureVisibleTab(windowId, options), scripting.executeScript({target, func, args}).
2. activeTab, scripting, clipboardWrite만 요청. visible, full 두 모드와 오류 응답 구현.
3. IndexedDB 전달, 전체 페이지 세로 합성, 스크롤 복구, 크기 제한, 활성 탭 검증 구현.

## Task 3: 편집기

파일: `extension/editor.html`, `extension/editor.css`, `extension/editor.js`, `extension/render.js`, `extension/model.js`.

1. 편집기 실제 동작 검증 스크립트를 먼저 작성하고 기능 누락으로 실패 확인.
2. 사각형, 원형 숫자 라벨, 화살표, 텍스트, 모자이크, 자르기, 선택 이동, 삭제 구현.
3. 색상·굵기·시작 번호, 단축키, undo/redo, 확대 축소, 파일 열기 구현.
4. PNG 합성 저장, clipboard copy, 자동 저장 및 복원 구현.

## Task 4: 검증 및 전달

파일: `tests/browser.mjs`, `scripts/package.mjs`, `README.md`, `docs/verification.md`.

1. `npm test`로 모델 검사.
2. 별도 Chromium 테스트 프로필에서 확장 로드, 캡처, 편집, 저장 PNG 픽셀, 복원, 전체 페이지 복구 검사.
3. 사용자 입력·메시지 출처·임시 저장·외부 전송 경로 리뷰.
4. ZIP 생성, 포함 파일 및 구문 검사. 설치 폴더와 3단계 설치 안내 전달.

## 실행 결정

사용자가 제작을 요청했으므로 이 세션에서 연속 실행한다. 새 프로젝트 전용 디렉터리로 격리하며 기존 프로젝트나 사용자 브라우저 프로필을 변경하지 않는다. 원격 저장소·웹스토어 게시 없이 로컬 확장과 ZIP을 전달한다.

후속 변경: 같은 날 사용자가 GitHub 오픈소스 공개를 요청함. MIT 라이선스로 공개하고 설치용 ZIP을 릴리스 자산으로 제공한다. 웹스토어 등록은 범위에 포함하지 않는다.
