# Event Moments – Bangalore Basecamp photo album

A static photo album built with plain HTML, CSS and JavaScript (no frameworks). Viewers can browse all photographs or browse by day, with each day split into **General** and **Session** categories. Photos can be opened in a lightbox and downloaded individually or as a ZIP.

## Repository layout

```
index.html        Page structure
css/styles.css    Styling
js/app.js         Application logic
manifest.json     Event settings, days, categories and the photo list
images/           All photographs (referenced from manifest.json)
```

## Adding photos

1. Copy the image files into the `images/` folder.
2. Open `manifest.json` and add an entry for each photo:

```json
{ "file": "images/day1-general-03.jpg", "title": "Opening keynote", "day": "day1", "category": "General" }
```

- `file` is the path to the image, relative to the site root.
- `title` is optional. If omitted, a readable name is generated from the file name.
- `day` must match an `id` in `days`, or be `null` for an unassigned photo.
- `category` must be one of the values in `categories` (`General` or `Session`), or `null` when unassigned.

Photos that are missing from the manifest do not appear on the site, so every image needs an entry.

## Assigning photos in Admin mode

Switch to **Admin** in the sidebar. The table lists every photo with its day and category. Change the dropdowns to assign or reassign photos, then click **Export manifest.json**. Replace `manifest.json` in the repository root with the downloaded file and commit it. The changes go live once GitHub Pages rebuilds.

The site has no server, so Admin mode does not require a login, and anyone who can open the site can view the admin screen. Changes are never saved to the repository automatically; they only take effect after the exported file is committed.

## Running locally

Open the folder with any static web server. Opening `index.html` straight from the file system will not load `manifest.json`.

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Hosting on GitHub Pages

1. Go to **Settings → Pages** in the repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select the `main` branch and the `/ (root)` folder, then save.

The site is then available at `https://sivarajdxc.github.io/bangalore_basecamp_gallery/`.
