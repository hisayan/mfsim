import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { disposeViewer } from "./viewer-dom.ts";

// ThreeView.dispose() は自動生成した DOM のみ除去し、呼び出し側が渡した
// container に追加した canvas を残す。後片付けで container を空にしないと
// 古い canvas が上に残り、新しいビューが見えなくなる（エリア切替の不具合）。

function fakeView(log: string[]) {
  return {
    dispose() {
      log.push("dispose");
    },
  };
}

function fakeContainer(log: string[]) {
  return {
    replaceChildren() {
      log.push("clear");
    },
  };
}

describe("disposeViewer", () => {
  it("disposes the view and clears the container", () => {
    const log: string[] = [];
    disposeViewer(fakeView(log), fakeContainer(log));
    assert.deepEqual(log, ["dispose", "clear"]);
  });

  it("clears the container even when the view is missing", () => {
    const log: string[] = [];
    disposeViewer(undefined, fakeContainer(log));
    assert.deepEqual(log, ["clear"]);
  });
});
