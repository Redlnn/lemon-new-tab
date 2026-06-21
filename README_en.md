[![lemon-new-tab](https://socialify.git.ci/redlnn/lemon-new-tab/image?custom_description=A+simple+local+new+tab+extension&description=1&font=Jost&language=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2FRedlnn%2Flemon-new-tab%2Frefs%2Fheads%2Fmaster%2Fassets%2Ficon.svg&owner=1&pattern=Circuit+Board&stargazers=1&theme=Auto)](https://lemon.redln.top)

<div align="center">

[Simplified Chinese](README.md) | English  
[Terms of Service](docs/TERMS_OF_SERVICE_en.md) | [Privacy Policy](docs/PRIVACY_POLICY_en.md)

</div>

## Installation

The extension is now available on
[Chrome Web Store](https://chromewebstore.google.com/detail/bhbpmpflnpnkjanfgbjjhldccbckjohb),
[Microsoft Edge Add-Ons](https://microsoftedge.microsoft.com/addons/detail/keikkgfgidagjlicckkangkfgnbdjdnh), and
[Firefox Browser Add-Ons](https://addons.mozilla.org/firefox/addon/lemon-new-tab/).

> You can also clone this repo and build it manually.

## Features

Make every new tab feel fast, effortless, and enjoyable.

Lemon New Tab is a local-first, open-source browser extension with no additional account required. Your core settings and personalized content stay in your browser, giving you fast loading, a clean interface, and no distracting news feed or ads.

**🔍 Flexible Search**  
&emsp;&ensp;Use Bing, Google, Baidu, DuckDuckGo, Yandex, and other search engines. Search suggestions, search history, and custom search engines help you quickly find what you need using a familiar workflow.

**🧭 Quick Links**  
&emsp;&ensp;Automatically display your most-visited sites, or add, pin, and rearrange your own links. Organize them into groups, browse with pages or scrolling, and switch to Dock or Launchpad layouts to keep favorite sites within easy reach.

**🔖 Browser Bookmarks**  
&emsp;&ensp;Search, open, edit, delete, and rearrange your browser bookmarks without leaving the new tab page.

**🖼️ Rich Wallpaper Options**  
&emsp;&ensp;Use Bing's daily image, an online image API, or local images and videos as your wallpaper. Extensive customization options help bring your background to life.

**🎨 Highly Customizable**  
&emsp;&ensp;A wide range of options lets you customize the layout, theme colors, and the position and appearance of individual components. Dynamic theme colors can even be extracted from your wallpaper to create a naturally coordinated page.

**🕒 Useful Without Distractions**  
&emsp;&ensp;Display the time, date, seconds, and lunar calendar. Enjoy a daily poem, motivational quote, or your own custom text, with one-click copying whenever you want to save it.

**⚡ Fast and Easy to Use**  
&emsp;&ensp;Continuously optimized for faster loading and lower resource usage, with responsive layouts and independent controls for performance and visual effects.

**🔄 Easy Backup and Sync**  
&emsp;&ensp;Import or export your settings, or use experimental cloud sync through your browser account. There is no separate account system, making setup and everyday use more convenient.

**⚛️ Built for Trust**  
&emsp;&ensp;Lemon New Tab makes all of its source code available under the AGPL-3.0 license and does not actively collect or send private data. It supports Chrome, Edge, and Firefox, providing a consistent experience across browsers.

> [!NOTE]  
> Contributions via PRs are welcome. Issues may not always be implemented.

## Changelog

[English](./docs/CHANGELOG_en.md) | [Chinese](./docs/CHANGELOG.md)

## Browser Compatibility

|                 Browser                  | Supported |              Notes               |
| :--------------------------------------: | :-------: | :------------------------------: |
|                  Chrome                  |    ✅     |       Chrome 116 and above       |
|                   Edge                   |    ✅     |        Edge 116 and above        |
|                 Firefox                  |    ✅     |      Firefox 128 and above       |
|              Firefox Mobile              |    ❌     | Unable to replace native new tab |
|               Edge Mobile                |    ❌     | Unable to replace native new tab |
| Other Chromium-based<br/>Mobile Browsers |    ❓     |             untested             |

> Lemon Start Page adapts to both landscape and portrait modes,
> but has not been tested or published on mobile browsers, so compatibility is not guaranteed.

## Preview

<details>
<summary>Click to expand screenshots</summary>

![Standard homepage](./preview/1.webp)  
![Solid-color background homepage](./preview/2.webp)  
![Homepage with Dock and large clock](./preview/3.webp)  
![Launchpad](./preview/4.webp)  
![Search page](./preview/5.webp)  
![Settings page](./preview/6.webp)

</details>

## Development

This project is built with Vue 3 (TypeScript) + Element Plus.

> [!WARNING]
>
> 1. I have not systematically studied HTML / CSS / JS / TS / Vue,
>    so the code quality may not be very high.
> 2. This project contains a large amount of AI-generated code.
>    Only basic reviews were performed to ensure the functionality works
>    and that no malicious code is included.
>    The overall quality/performance may still have issues to some extent —
>    thank you for your understanding.
> 3. PRs are welcome.

### Build

#### For Chrome

```sh
git clone https://github.com/Redlnn/lemon-new-tab.git
cd lemon-new-tab
pnpm install
# pnpm dev  # Run development mode, opens in a standalone browser
# Build
pnpm build  # Build as (unminified) Chrome extension
pnpm zip    # Package Chrome extension
```

#### For Firefox

```sh
git clone https://github.com/Redlnn/lemon-new-tab.git
cd lemon-new-tab
pnpm install
# pnpm dev  # Run development mode, opens in a standalone browser
# Build
pnpm build:firefox  # Build as (unpacked & unsigned) Firefox extension
pnpm zip:firefox    # Package Firefox extension
```

## Known Issues

1. Some Chromium-based browsers on Windows may freeze at startup.
   Disabling **GPU hardware acceleration** or switching  
   **Choose ANGLE graphics backend** to `OpenGL` in
   [Experiments](chrome://flags/#use-angle) can help.
   > - Likely caused by GPU driver or system issues.
   > - Chromium discourages rendering via OpenGL API, but other settings may also help (might reduce stutter but risk frame drops).

## Credits

- [Lime Start Page](https://limestart.cn/): Inspiration for Lemon Start Page.
  Layout, animations, and some CSS were referenced.
- [Light Tab Page](https://github.com/Devifish/light-tab-page):
  Source of custom wallpaper storage implementation.

## License

This project is open-sourced under the AGPL-3.0 License, except for trademark-related images in `entrypoints/newtab/assets`.

> This project has been open-sourced under the AGPL-3.0 License since version v3.2.3 (commit 65a894c0d8009d274618c5004a634d7359b2b0a6). Previous versions were open-sourced under the MIT License.
