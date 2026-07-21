# 视觉资产

本目录存放 Epoch 的品牌与界面视觉资产。

| 文件 | 用途 |
| --- | --- |
| `banner.png` | README 顶部横幅 |
| `icon.png` | 应用图标 |
| `favicon.png` | PNG 格式的网站图标 |
| `favicon.ico` | ICO 格式的网站图标 |
| `color-palette.png` | 主题色板预览 |
| `theme.css` | 可直接使用的 CSS 主题变量 |
| `fonts/Montserrat-SemiBold.ttf` | EPOCH 字标与展示标题字体，字重 600 |
| `fonts/OFL.txt` | Montserrat 的 SIL Open Font License 1.1 |
| `fonts/README.txt` | Montserrat 字体包说明 |

## 字体使用

`theme.css` 已注册本地字体，可通过主题变量使用：

```css
.epoch-title {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: 0.2em;
}
```

颜色定义与使用规范参见 [THEME.md](../docs/THEME.md)。
