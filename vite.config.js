import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [vue()],
	base: "./",
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
	build: {
		// Electron 44（Chromium 152）已高于 vite 8 （Chrome 111）；
		// 若回退 Electron 21 需恢复 target: 'chrome106'
		// vite 8 默认 lightningcss 压缩器拒绝 plyr 的 `::after:empty` 伪类组合，回退 esbuild
		cssMinify: "esbuild",
	},
});
