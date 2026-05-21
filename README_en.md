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

- Fast⚡ – Purely local, high-performance, fast loading
- Search 🔍 – Instant suggestions and customizable search engine.
- Flexible 🌈 – Customize and combine page layouts to adjust appearance to your preference with rich options
- Elegant 🎨 – With rich custom color options and Monet-based color extraction, the interface becomes cleaner and more visually appealing.
- Wallpapers 🖼️ – Support for Bing daily wallpapers, custom online APIs, and local images/videos
- Quotes 💬 – A classical Chinese poem or motivational quote each time you open a new tab
- Open Source ⚛️ – No worries about privacy leaks or malicious code
- Internationalization 🌐 – Built-in multi-language support (Include Simplified / Traditional Chinese, Cantonese)
- Bookmark 🔖 – Search and open the bookmark from the browser
- Shortcuts 🪜 – Display/pin frequently visited sites and add your own custom shortcuts
- Dark Mode 🌓 – Support for dark mode, with an option to follow the system setting

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
