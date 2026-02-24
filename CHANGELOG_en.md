# Changelog

> Translated by AI from Chinese.

## 3.2.0 (WIP)

### New Features✨

- Full keyboard navigation support (`Tab` + arrow keys)
- Support for saving the currently displayed online wallpaper

### Improvements⚡️

- Minor adjustments to UI elements and translations
- Disabled the search bar expansion animation on startup by default due to performance issues on most devices
- When caching is enabled, cached wallpapers will continue to be used even after expiration if new wallpapers cannot be fetched

### Bug Fixes🐛

- Fixed an issue where clicking the quote widget would cause the search bar to lose focus

## 3.1.0 (Feb 14, 2026)

### Happy Chinese New Year🧨

Wishing you a happy Chinese New Year! May your days be as fresh and wonderful as lemons! Thank you for your continued support and feedback, and we look forward to continuing to accompany you in the new year!

### New Features✨

- **Shortcut:** Added "Title Expand Width" and "Icon and Title Spacing" settings
  ([#65](https://github.com/Redlnn/lemon-new-tab/issues/65))
- **Bookmarks Bar:** You can now bookmark shortcuts to browser bookmarks via the right-click menu
- **Bookmarks Bar:** Added support for editing and deleting bookmarks
- **Bookmarks Bar:** Added support for dragging to reorder bookmarks
- **Bookmarks Bar:** Added support for collapsing other/all sibling directories
- **Bookmarks Bar:** Added support for setting the default sort order for the Bookmarks Sidebar
  ([#68](https://github.com/Redlnn/lemon-new-tab/issues/68))
- **Clock:** Added support for setting clock font weight
- **Clock:** Added support for setting AM/PM font size to follow time font size
- **Clock:** Added support for setting clock font size (small, medium, large)
- **Search:** The search bar now supports closing with the Esc key.
- **Online Wallpaper:** Added support for caching and manual refresh.
  ([#69](https://github.com/Redlnn/lemon-new-tab/issues/69))

### Improvements⚡️

- Optimized performance and refined details.
- Improved mobile layout stability (alignment, jitter, overlap)
- Force refresh when switching to Bing wallpaper
- Monet color extraction updated to the 2025 spec
- **Shortcut:** Improve pagination logic
- **Shortcut:** Optimized the trigger priority of swipe pagination and
  drag sorting for quick access when touching
  > Now pagination is less likely to trigger drag sorting
- **Shortcut:** Adjust the order and icon thickness of the shortcut right-click menu options
- **Shortcut:** Refactored shortcut layout logic for better performance and mobile support
- **Bookmarks Bar:** In the bookmark sidebar, folders are only placed at the front when not in original sorting
- **Bookmarks Bar:** Changed the default sorting of the bookmark sidebar to original sorting
- **Bookmarks Bar:** Allow multiple same-level directories to be expanded in the bookmark sidebar
- **Bookmarks Bar:** Default to expanding the first top-level directory with content
- **Clock:** Adjusted the placement of AM/PM in English environments to be before the time

### Breaking Change💥

- Compatibility with old version configurations has been removed. If unsupported configuration data is encountered, a prompt will appear to reset settings and clear data
- **Shortcut:** Quick Access: Removed the “Show area background” option due to lack of maintenance and conflicts with the paginated layout style.

### Bug Fixes🐛

- Fixed security issues when importing settings
- Added missing settings version migration function for cloud sync
- Fixed issue where settings migration logic did not take effect
- Fixed issue where enabling cloud sync would overwrite cloud configuration
- Attempted to fix background loss when navigating back to the new tab on mobile
- **Search:** Fixed issue where changes to bookmarks made elsewhere would not sync
  to already opened new tab pages
- **Bookmarks Bar:** Fixed an issue where suggestions appeared after the search field lost focus
- **Shortcut:** Fixed an issue where some shortcut titles were clipped when the window width was reduced
- **Shortcut:** Fixed an issue where parts of shortcut titles from the previous and next pages were visible
- **Shortcut:** Fixed issue where shortcut pagination flickered on Firefox
  ([#64](https://github.com/Redlnn/lemon-new-tab/issues/64))
- **Background:** Fixed issue where white background flickered briefly when first opening in dark mode
- **Settings:** Fixed issue where dark mode button did not follow system changes when "Follow

## 3.0.1 (Jan 02, 2026)

### Bug Fixes🐛

- Fixed issue where shortcut icon background blur did not work on Firefox
  ([#64](https://github.com/Redlnn/lemon-new-tab/issues/64))

## 3.0.0 (Jan 01, 2026)

### Happy New Year🎇

1. Now you can click the browser extension toolbar icon to quickly add the current page to shortcuts!
2. Shortcuts can now be paginated!
3. Adjusted and unified corner radii across the board, ushering in the "Age of Big Corners"!

### New Features✨

- Support setting shortcuts to open in a new tab by default
- Support adding the current page to shortcuts from the browser toolbar button
- Support adding pages to shortcuts from the bookmarks sidebar
  ([#55](https://github.com/Redlnn/lemon-new-tab/issues/55))
- Shortcuts support pagination
  ([#57](https://github.com/Redlnn/lemon-new-tab/issues/57))
  > Pagination methods:
  >
  > 1. Click the pagination buttons to switch pages (for devices with a mouse only)
  > 2. Scroll the mouse wheel in the shortcuts area to switch pages (for devices with a mouse only)
  > 3. Support touch swipe gestures to switch pages (for touch-enabled devices only)
  > 4. Click the page indicators below the shortcuts area to switch pages
- Support customizing the relative size of shortcut icons to their containers
  ([#58](https://github.com/Redlnn/lemon-new-tab/issues/58))
- When the search box is always expanded,
  support displaying the search engine icon and search button by default
  ([#60](https://github.com/Redlnn/lemon-new-tab/issues/60))
- Support speeding up the display of the background at startup
  and disabling background transition animations
  ([#62](https://github.com/Redlnn/lemon-new-tab/issues/62))
- Support not hiding quick access when the search box is focused
  ([#63](https://github.com/Redlnn/lemon-new-tab/issues/63))
- Right-click menu supports copying link address and opening in a new window

### Improvements⚡️

- Cache Monet color extraction results for use on next startup to avoid abrupt changes
- When adding shortcuts, allow omitting the protocol prefix (http:// or https://)
- Optimize the styles of the "Add Shortcut" and "Add Search Engine" dialogs
- Reduce the size of the pin icon for pinned links
  ([#61](https://github.com/Redlnn/lemon-new-tab/issues/61))
- Comprehensively adjusted all corner radii for a better visual experience
- Optimize right-click menu styles
- Optimized performance

### Bug Fixes🐛

- Fixed issue where shortcut drag-and-drop sorting UI did not update
  ([#53](https://github.com/Redlnn/lemon-new-tab/issues/53))
- Fixed issue where changes to shortcuts on the new tab page
  were not promptly synced from cloud sync, popup menu, and other sources
- Fixed shortcut title text shadow being cut off
- Fixed issue where pinned link icons were incorrect after using drag-and-drop sorting
- Fixed style issues in the search engine selector
- Fixed issue where the dark mode wallpaper would not immediately switch to the light mode wallpaper
  after deleting the dark mode wallpaper
- Fixed issue where shortcuts were displayed before they were fully loaded at startup
- Fixed issue where the left and right areas of quote could not trigger the bookmark sidebar with right-click
- Fixed issue where the most visited page titles could not be obtained on Firefox
- Fixed issue with quote appearance and disappearance animations
- Fixed several other minor issues

## 2.7.0 (Dec 10, 2025)

### Major Update🎉

Monet colors from Material Design 3 — bring softer, more dynamic hues to your new tab page!

### New Features✨

- Brand new dynamic theme color (Monet color extraction)
- Option to disable the search bar expansion animation on startup
- Support for displaying seconds in the clock
  > Enabling this feature increases performance usage

### Improvements⚡️

- Optimized launch speed
  - Optimized the appearance animations of the search bar and clock components
  - Optimized background image loading logic
  - Optimized bookmark loading logic
- Resets bookmark sorting when switching languages
- Optimized the style of the "Add New Shortcut" window on narrow screens
- Adjusted wallpaper fade-in animation duration for a more elegant experience
- When searching bookmarks, if a folder name matches, all its children are displayed to avoid empty folders
- Optimized bookmark search performance

### Bug Fixes🐛

- Fixed button background issues in global color mode.

## 2.6.0 (Nov 23, 2025)

### New Features✨

- Brand new wallpaper selection page
- Support showing browser bookmarks for quick access to favorite websites

### Improvements⚡️

- Re-added the "Blinking Time Separator" setting in the clock settings page
- Added video wallpaper pause option in the performance settings page
- Added Bilibili link to the About page
- Adjusted the CopyRight link on the About page to personal homepage

### Bug Fixes🐛

- Fixed the issue where the background mask would flicker on startup
  ([#46](https://github.com/Redlnn/lemon-new-tab/issues/46))
- Fixed some misalignment issues in the Quote settings page
- Fixed style and layout issues of Quote on the About page
- Fixed settings button pop-up menu not transparent
- Fixed missing translations

## 2.5.4 (Nov 03, 2025)

### New Features✨

- One-click enable all performance settings
- Added two new theme colors
- Support for switching languages
- Support for exporting and importing favorite/pinned websites
  ([#45](https://github.com/Redlnn/lemon-new-tab/issues/45))
- Support for custom search engines (and import/export)
- Right-click to open shortcut menu, removed the long-term display of the three-dot entry to optimize visual experience

### Improvements⚡️

- Adjusted translations for various languages
- Optimized saving logic; changing theme colors no longer has a delay
- Optimized code logic to improve performance
- Improved UI and UX
- Unified the naming of settings
- "Support Us" popup can now be closed with esc key and by clicking outside
- In the settings page, changing the search engine now opens the search engine switcher

### Bug Fixes🐛

- Fixed incorrect background color in the "Add Shortcut" window
- Fixed issue where global font overrides were not applied

## 2.5.3.1 (Oct 25, 2025)

### Bug Fixes🐛

- Fixed issue where adjusting chunk settings caused loading order changes, leading to i18n failure.

## 2.5.3 (Oct 25, 2025)

### New Features✨

- Added Help and Feedback page
  ([#41](https://github.com/Redlnn/lemon-new-tab/issues/41))
- Support for disabling the transparency effect of Quote

### Improvements⚡️

- Cleaned up obsolete dark mode theme color switching logic
- Greatly enhanced the "Apply theme color to more elements" feature; now, when enabled, the theme color covers a wider range of elements
  - Enabling this feature + disabling transparency effect makes it very similar to Material You
- Adjusted color combinations on some pages to improve visual experience

### Bug Fixes🐛

- Fixed issue where switching colors did not have a transition effect.
- Fixed issue where wallpapers did not display in dark mode when only light mode wallpapers were uploaded and the wallpaper type was set to image.
  ([#40](https://github.com/Redlnn/lemon-new-tab/issues/40))
- Fixed missing styles.
- Fixed issue where the dark mode button state did not follow browser or system changes.
  ([#42](https://github.com/Redlnn/lemon-new-tab/issues/42))
- Fixed missing color transition animations for some elements on the settings page.
  ([#43](https://github.com/Redlnn/lemon-new-tab/issues/43))
- Fixed localization errors/missing translations.

## 2.5.2 (Oct 21, 2025)

### New Features✨

- Brand new macOS-style settings page
  ([#39](https://github.com/Redlnn/lemon-new-tab/pull/39))
- Added "Hide major update changelog" switch (enabled by default)
- Added `text-autospace: normal` to add spacing between CJK and non-CJK characters
- Support for hiding the search box and clock

### Improvements⚡️

- Cached search history for smoother input
- Cached search suggestions for smoother input
- Cached quick access for smoother resizing or settings adjustments
- About page now uses SVG icons for improved clarity
- Optimized performance when saving settings
- Optimized wallpaper loading and switching performance
- Optimized page loading speed

### Bug Fixes🐛

- Fixed issue where search suggestions did not appear or were unrelated to input when using CJK input methods
- Fixed issue where resizing the window did not refresh the quick access area
- Fixed issue where some styles were not applied
- Fixed missing shadow display on settings items
- Fixed missing rounded corners in the "Add Quick Access" dialog
- Fixed dark mode not following system changes
- Fixed issue where color schemes were not reapplied in dark mode (26068c3)
- Fixed style conflicts

## 2.5.1 (Oct 12, 2025)

> This update fixes a potential issue where deleting wallpapers in the extension
> might not actually remove the wallpaper cache from the browser.  
> It is recommended to use the "Clear Wallpaper Cache" feature to clean up past caches.

### New Features✨

- Option to clear wallpaper cache separately

### Improvements⚡️

- Improved extension stability
- Optimized extension performance

> ~~MIUI couplets update~~ (just kidding)

### Bug Fixes🐛

- Fixed issue where changelog window did not pop up during major version updates
- Adjusted clock CSS styles to fix inconsistent spacing between time and date in different states
- Fixed issue where dark mode-specific wallpapers did not refresh correctly in dark mode

## 2.5.0 (Oct 11, 2025)

### New Features✨

- Added option to "Apply theme color to more elements"
- Revised and expanded preset color schemes with added color names
- For minor version updates, replaced changelog pop-up with a bottom notification message to avoid frequent interruptions
- Added red dot indicator at the bottom-right corner to show unread changelog updates
- Added automatic favicon fetching for shortcuts on Firefox (mostly ineffective due to cross-origin restrictions)
- Support editing pinned shortcuts
- Added automatic favicon fetching on Firefox (mostly defaults due to cross-origin restrictions)

### Improvements⚡️

- Changed default theme color
- Replaced i18n framework to prevent Windows from treating `zh-HK` as `zh-TW`, ensuring proper display of `zh-HK` translations display correctly
- Adjusted font weight of buttons and some links for better appearance
- Optimized button animations and styles
- Optimized clock formatting code to improve performance and readability
- Adjusted Element Plus i18n import method to enhance performance and reduce bundle size
- Removed obsolete code
- Notifications now appear from the bottom
- Adjust the positions of some options
- Improved performance and code maintainability
- Optimized configuration sync strategy
- Expanded the effective scope of performance options
- Input field no longer clears when adding a shortcut with an invalid URL
- Less frequently used pages have been changed to dynamic imports to reduce memory usage and speed up loading times

### Bug Fixes🐛

- Fixed issue where dayjs i18n was not working
- Fixed time alignment issue when "Small Clock Font" is disabled
- Fixed incorrect style of the custom shortcut icon upload button
- Fixed a missing translation
- Fixed an issue where the config version might not update in time
- Fixed issue where shortcuts could not be saved on Firefox
  ([#37](https://github.com/Redlnn/lemon-new-tab/issues/37))
- Fixed issue where dragging non-pinned shortcuts caused the shortcut area to disappear
- Fixed misalignment issue when using SVG for custom shortcut icons

## 2.4.1 (Sep 30, 2025)

### New Features✨

- Added performance options to the settings button at the bottom-right corner
- Added one-click disable effects, unified button styles on the settings page
- Added "back to top" buttons for increasingly long settings and changelog pages

### Improvements⚡️

- Added performance tips related to video backgrounds
- Performance optimizations
- Unified descriptions of performance options: previously “enable switch to disable xxx,” now “switch to turn off xxx”
- Standardized blur effects across the app (except for some that affect visuals)

### Bug Fixes🐛

- Fixed search bar animations not triggering on click
- Fixed CSS broken due to upstream updates

## 2.4.0 (Sep 25, 2025)

### Important Notice❗

- When upgrading from a version <2.3.0 to ≥2.3.0,
  the search box appearance and functionality may appear abnormal.
  However, this issue has not been fully reproduced yet.
  You can reselect the search engine in the settings page to resolve it.
  Thank you for your understanding.

### New Features✨

- **Support setting video wallpapers**
- Support disabling dialog popup animations

### Adjustments⚡️

- Improved CSS readability, fine-tuned details, and removed invalid CSS

### Fixes🐛

- Fixed an issue where a pure white or pure black background was unexpectedly
  applied when no background was set
- Fixed an issue where the menu failed to disappear after switching the search
  engine in the search bar

## 2.3.4 (Sep 17, 2025)

### New Features✨

- Added performance settings to disable high-performance effects for a better
  experience on low- and mid-range devices
- Added 2 new candidate search engines

### Fixes🐛

- Fix the issue where the clock is not centered when
  "Small Time Font" is turned on

## 2.3.3 (Sep 13, 2025)

### Fixes🐛

- Fix the issue where the clock is not centered when
  "Small Time Font" is turned on
- Fix some dialogs that are not internationalized

## 2.3.2 (Sep 07, 2025)

### New Features✨

- Added support for setting separate wallpapers for light and dark modes
  > If no dark mode wallpaper is set, the light mode wallpaper will be used as a fallback
- Added the ability to delete selected background images

### Fixes🐛

- Fixed an issue where resetting the extension data did not clear all caches
- Fixed an issue where the "Add Shortcut" button's background blur was not applied

## 2.3.1 (Sep 02, 2025)

🎉 Today marks the first anniversary of Lemon New Tab — and thankfully,
it didn’t crash and burn along the way!
Huge thanks to everyone who supported, and tested it (in the best way).
Here’s to another year of making your browsing better!

### Fixes🐛

- Fixed abnormal state and ineffective issues with icon shadow toggle
- Fixed spacing issues on the quick access settings page

### Adjustments⚡️

- Cleaned up some redundant code

## 2.3.0 (Sep 01, 2025)

### Features✨

- Option to change the clock font to a smaller size (same as AM/PM)
- Customizable search box placeholder text
- Added search engine settings page
- Support for importing and exporting configuration files for easy backup and migration
- Enhanced quote feature: added caching and switchable APIs
- New option to keep quote always visible
- Quote supports toggling shadows and adjusting inverse colors
- Power-saving mode (can disable blinking time separator)
  > Probably no one keeps the new tab page open forever, right?

### Adjustments⚡️

- Due to browser policy restrictions, auto-focus on the search box has never worked properly,
  so the description has been changed to “Expand search box by default”
- Adjusted text and search box shadows, added shortcut shadows for better visual appearance
- UI, UX, and animation refinements to enhance the user experience
- Moved the About section from Settings to a new dedicated About page
- The new About page and Search Engine Settings page share the bottom-right entry point with the main Settings page

### Fixes🐛

- Multiple stability improvements
- Fixed missing translations and several minor bugs.

## 2.2.3 (Jul 13, 2025)

### Optimization⚡️

- Automatically hide the pinned icon when `Show Most Visited` is turned off

### Fixes🐛

- Fixed the issue where previously displayed Most Visited items were not removed after
  turning off `Show Most Visited`
- Fixed the issue of high CPU usage during window resizing
- Fixed an issue where wallpapers would change on other clients due to cloud sync
  > Since local images are limited by storage size and online images are restricted by
  > permissions, wallpapers cannot be synced, so wallpaper-related data will not be synced

## 2.2.2 (Jul 10, 2025)

### Optimization⚡️

- Adjusted background image loading timing to minimize visibility of the loading process

### Fixes🐛

- Fixed a flickering issue that occurred during each load when the background mask was enabled

## 2.2.1 (Jul 07, 2025)

### Fixes🐛

- Fixed an issue where the local background selection box style was not applied

## 2.2.0 (Jul 07, 2025)

### Features✨

- Added toggle for switching between day and night mask colors.
- Added reminder for items that do not support cloud synchronization.
- Implemented cloud synchronization for settings and shortcuts. The following features
  do not support synchronization:
  - Local or online background images
  - Most visited sites (including ignored sites)
  - Dark mode and system-following status, etc.

### Optimization⚡️

- Refactored a large amount of code.
- Updated and completed translations.

### Fixes🐛

- Fixed the issue where the background mask color did not take effect.
- Fixed the issue where the default font did not apply for English systems.
- Fixed the issue where Element components always used zhCn for i18n.
- Prevented the description of quote switch from being too long in English environments.

## 2.1.0 (Jun 07, 2025)

### Optimization⚡️

- Set the clock font to monospace for improved visual appearance.
- Adjusted font selection order to enhance aesthetics.
- When manually adding a shortcut, pressing Enter now submits it to improve user experience.
- Reduced background opacity of the pin icon on pinned shortcuts to improve visual
  appearance.
- Adjusted CSS order and removed component restrictions to reduce extension size.
- Refactored most of the JS and some CSS to improve performance.
  - Fixed bugs related to configuration upgrades.
  - Replaced axios with fetch API to reduce size.
  - Implemented background change animations with new syntax.
  - Fixed spelling errors.
  - Thanks to Copilot for assistance.

### Fixes🐛

- Fixed an issue where Latin text for some Linux users was falling back to emoji fonts.

### Others🙈

- Refactored code to improve readability.

## 2.0.0 (Mar 20, 2025)

**Important**: Major version upgrade, please carefully read the following changelog.

### Known Issues❗

- Some Windows devices may experience a freeze on startup when setting the
  Chromium-based browser’s homepage. The solution can be found in the
  [README](/README.md#已知问题).

### Features✨

- Optimized performance to improve opening speed and avoid lag in certain situations.
- Pinned quick access links can now be reordered by dragging.
- Refactored the layout style of the quick access area for better compatibility.
  Due to this refactoring, some existing settings may have been reset.
  We apologize for any inconvenience.
- Refactored configuration storage and internal version iterations.
  Due to this, some existing settings may be misaligned during configuration upgrades.
  We apologize for any inconvenience.
- Added options for “using white font in light mode for quick access” and “icon spacing”.
  The original “icon width” setting has been changed to “icon size”.
- "Adjust the page's responsive styles to prevent misalignment when shrinking the browser,
  thus supporting use on narrow-screen devices
  (unfortunately, Firefox mobile add-ons cannot replace the new tab page).
- Default search engine is now Bing.

### Fixes🐛

- Fixed an issue where the search box could not lose focus by clicking the original
  quick access area after expanding.
- Applied clock font settings to the quote to improve
  page appearance in dark mode.
- Fixed an issue where clicks on some areas of the quick launch submenu did not work.
- Fix auto focus search box not working (unfortunately Chrome prioritizes address bar).

## 1.8.1 (Mar 05, 2025)

### Fixes🐛

- Fixed the issue that background color does not follow system (or browser)
  when JS is not loaded
  ([#19](https://github.com/Redlnn/lemon-new-tab/issues/19))
- Fixed the logic and animation issues of "Dark mode" and "Follow system" switch

## 1.8.0 (Jan 05, 2025)

### Features✨

- You can now use online image APIs as wallpaper.
- Added a toggle for dark clock font.

## 1.7.0 (Dec 17, 2024)

### Features✨

- **Updated default theme colors and icons.**
- Improved translation for zh_tw.
- Added transition effects when switching background types. However,
  users with slow internet or low-performance devices may still notice
  the new background image appearing abruptly.
- Enhanced the display effect for solid color backgrounds
  (when the background type is set to "None").
  - Clock font color now inverts on solid color backgrounds.
  - The search box background is now static pure white with an added outline.
  - Added the option to disable shadows for the clock, search box, and quick access area.

### Improvements⚡️

- Adjusted the timing of background loading to avoid freezing the page
  when fetching the background.
- Standardized animation durations for a smoother experience.
- Did not display the container for the quote when it was unavailable.
- Show error message when failing to get Bing wallpaper.

### Fixes🐛

- Fixed the issue where wallpaper preview did not display after switching wallpaper types multiple times in the settings page.

## 1.6.1 (Dec 12, 2024)

### Features✨

- Now the search box can automatically focus when opening the new tab (disabled by default).

### Fixes🐛

- Fixed the issue where the Quick Start area would flicker when loading the new tab page.
- Optimized the style of the "Add New Shortcut" button by reducing its opacity
  when the mouse is not hovering over it.

## 1.6.0 (Oct 09, 2024)

### Features✨

- Added support for customizing icons when adding pinned access.
- You can now open the changelog again via the right-click settings button.
- Improved visual experience when the color mode is set to follow the system.
- Updated the default theme color and optimized the appearance of some components.

### Fixes🐛

- Fixed the issue where the browser would redirect Bing to the national region.
  > To restore non-national region access, you need to clear the \*.bing.com
  > cookies in your browser.
- Reduced CPU usage
- Moved the settings initialization phase earlier to avoid seeing the default settings state when opening a new tab.

## 1.5.4 (Sep 18, 2024)

### Features✨

- Added support for displaying the date and Chinese lunar calendar.
- Brand new settings window and changelog window.
- Using <www.bing.com> instead of cn.bing.com to avoid redirection when using Bing.
- Now you can change the background mask color.
- Now you can disable the background of the quick access area.
- Optimized the position of the search bar after closing the quick access area.
- **Firefox**: Now supports setting it as the homepage
  ([#12](https://github.com/Redlnn/lemon-new-tab/issues/12)).

### Fixes🐛

- Now the search engine dropdown in the settings page can display the full name of Google.
- Fixed the issue where the background blur was set to a fixed value
  when focusing the search bar.
- Fixed the issue of browser freezing, high CPU usage,
  and memory leaks when using local images as backgrounds.

## 1.5.3 (Sep 07, 2024)

### Features✨

- Partial refactor to support Firefox browser.
- Supports caching of Bing's daily image.
- Added transition animation for local backgrounds or cached Bing wallpapers.
- Optimized the display of the 12-hour clock format.
- Internationalization support.

### Fixes🐛

- Fixed the issue where unpinning did not take effect.
- Fixed the issue where frequently visited sites could not be deleted
  ([#8](https://github.com/Redlnn/lemon-new-tab/issues/8)).
- Fixed the issue where the "Enable Most Visited" switch did not work.
- Fixed the issue where duplicate shortcuts appeared after hiding most visited.
- Hid Chrome-specific hints in Firefox browser.
- Fixed the issue where search suggestion API candidates and icons could not be displayed.
- Remove Herobrine

> For earlier update logs, please refer to the commit history
