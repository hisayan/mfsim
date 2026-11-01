import { defineConfig } from "vite";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";

export default defineConfig({
  plugins: [
    voidPlugin(),
    voidReact({ react: { compiler: true } }),
  ],
  server: {
    // 別PCからの動作確認のため LAN に公開する
    host: "0.0.0.0",
  },
});
