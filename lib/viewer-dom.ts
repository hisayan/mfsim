// ThreeView の後片付け。dispose() は自動生成 DOM のみ除去し、呼び出し側の
// container に追加した canvas を残すため、明示的に container を空にする。
// これを怠ると古い canvas が残り続け、再生成したビューが見えなくなる。

type DisposableView = {
  dispose(): void;
};

type ClearableContainer = {
  replaceChildren(): void;
};

export function disposeViewer(
  view: DisposableView | undefined,
  container: ClearableContainer,
): void {
  view?.dispose();
  container.replaceChildren();
}
