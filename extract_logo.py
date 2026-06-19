import os
from PIL import Image

image_dir = r"c:\Users\Admin\Downloads\watch-auto-publisher\backend\uploads\SapoImages"
output_path = r"c:\Users\Admin\Downloads\watch-auto-publisher\backend\uploads\vua_dong_ho_logo.png"

# Get first image
image_files = [f for f in os.listdir(image_dir) if f.endswith('.jpg') or f.endswith('.png')]
if not image_files:
    print("No images found")
    exit(1)

for image_file in image_files:
    img_path = os.path.join(image_dir, image_file)
    try:
        img = Image.open(img_path).convert("RGBA")
        width, height = img.size
        # The logo seems to be in the top-left, roughly within a 350x350 box on a 1000x1000 image.
        crop_size = min(width, height) // 3
        box = (0, 0, crop_size, crop_size)
        cropped = img.crop(box)

        # Make white background transparent
        new_data = []
        min_x, min_y = crop_size, crop_size
        max_x, max_y = 0, 0

        for y in range(crop_size):
            for x in range(crop_size):
                r, g, b, a = cropped.getpixel((x, y))
                # White or near white -> transparent
                if r > 200 and g > 200 and b > 200:
                    new_data.append((255, 255, 255, 0))
                else:
                    # Treat dark as the logo
                    new_data.append((0, 0, 0, 255))
                    if x < min_x: min_x = x
                    if x > max_x: max_x = x
                    if y < min_y: min_y = y
                    if y > max_y: max_y = y

        cropped.putdata(new_data)

        # Crop to the actual bounding box
        if max_x > min_x and max_y > min_y:
            pad = 5
            final_box = (max(0, min_x - pad), max(0, min_y - pad), min(crop_size, max_x + pad), min(crop_size, max_y + pad))
            logo_only = cropped.crop(final_box)
            
            # Check if this looks like a valid logo (not just a random speck)
            w, h = logo_only.size
            if w > 30 and h > 30:
                scale = min(400/w, 400/h)
                new_w = int(w * scale)
                new_h = int(h * scale)
                logo_resized = logo_only.resize((new_w, new_h), Image.LANCZOS)
                
                final_img = Image.new("RGBA", (500, 500), (0, 0, 0, 0))
                paste_x = (500 - new_w) // 2
                paste_y = (500 - new_h) // 2
                final_img.paste(logo_resized, (paste_x, paste_y))
                final_img.save(output_path, "PNG")
                print(f"Saved logo from {image_file} to {output_path}")
                break
    except Exception as e:
        print(f"Failed to process {image_file}: {e}")
