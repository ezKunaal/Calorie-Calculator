# Calorie-Calculator
This Calculator uses your camera to predict the calorie in your food.

## Features
- 📷 **Snap your food**: take a photo (or upload one) and the app guesses what it is, showing its top 4 matches.
- 🔥 **Daily calorie ring**: every meal you add fills the ring towards your daily goal.
- 💪🌾 **Protein & fiber tracking**: progress bars for each, with goals you choose.
- ⚖️ **Portions**: ½× to 3× of a typical serving.
- 🔍 **Manual search & custom foods** for anything the camera misses.
- 📅 **History**: step back through previous days.
- 🔒 **Private**: food recognition runs entirely in your browser, and your meals and goals are stored on your device.

## How the food recognition works
The app uses [CLIP](https://huggingface.co/Xenova/clip-vit-base-patch32) via [Transformers.js](https://huggingface.co/docs/transformers.js), a free model that runs on your device. It compares your photo with every food in `foods.js` and ranks the matches. The first time you take a photo, the model (~150 MB) downloads. After that, your browser caches it.

Nutrition values in `foods.js` are approximate per-serving averages. To add a food, add a line to `foods.js`, and the camera will start recognising it as well.

## Run it
It's plain HTML/CSS/JS, with no build step.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Camera access needs HTTPS (or localhost). The easiest way to put it online is **GitHub Pages**: go to *Settings → Pages → Deploy from branch → `main` / root*.
