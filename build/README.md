# tray icons

run `node scripts/tray-icons.mjs` from the repository root to regenerate the tray assets. run `node scripts/tray-icons.mjs --check` to verify that the committed outputs match their sources without rewriting them. the script uses `sharp`, which is already installed as a transitive dependency in the locked dependency tree. it does not add a dependency or launch the desktop app.

the letter comes from `icon-mac.png`. the script selects the 336 by 488 pixel region starting at pixel (318, 268) and retains pixels whose red, green, blue, and alpha values are all at least 240. this separates the white letter from the scenery. the resulting transparent white shape is saved as `tray-glyph.png`. update the crop if the source artwork changes.

`trayTemplate.png` and `trayTemplate@2x.png` contain the same black shape at 16 and 32 pixels. their transparent canvases include one and two pixels of vertical padding, respectively. only the letter contributes opacity, so macos can tint the template for light and dark menu bars.

`tray.ico` contains 16, 24, and 32 pixel images for windows. `tray.png` is the 32 pixel linux image. both use the white letter on the indigo rounded tile defined in `tray-tile.svg`. the tile and its lighter outline keep the letter visible against both light and dark tray backgrounds. these images retain transparent corners.

runtime integration should load the template pair on macos, `tray.ico` on windows, and `tray.png` on linux.
