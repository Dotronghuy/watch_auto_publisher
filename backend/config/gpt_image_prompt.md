# GPT Image Prompt - Common Watch Replacement

## SKU ROUTING

- SKU with **G** in the watch code, for example `735G`, `735G1-D4`, `8821G`, uses the **MALE** prompt.
- SKU with **L** in the watch code, for example `55800L`, `55800L-D1`, `593L`, uses the **FEMALE** prompt.
- If the SKU gender cannot be detected, use the **NEUTRAL** prompt.

## COMMON BASE PROMPT

Use only the two images attached in this message.

Image 1 is the exact product watch.
Image 2 is only the scene, wrist, lighting, camera angle, and background reference.

Remove the watch currently visible in Image 2 and replace it with the watch from Image 1.
Preserve the watch from Image 1 as closely as possible: case shape, bezel, dial layout, hands, bracelet or strap style, color, and overall proportions.
Do not copy the watch design from Image 2.
Keep the watch at a realistic adult wristwatch size. On wrist shots, the watch case should look prominent and natural on the wrist, not tiny or miniature.
On wrist shots, the bracelet or strap must look physically real: both sides must attach cleanly to the lugs, curve naturally around the wrist, keep the same material/width/detail from Image 1, and create subtle contact shadows where it touches skin or sleeve. The strap must not look like a flat black patch, painted band, melted cuff, floating slab, broken strip, oversized cuff, or fake sticker on the wrist.
For flat lay, table, fabric, product-only, or any non-wrist scene, the bracelet or strap from Image 1 must remain complete and uncropped. If Image 1 has a leather, rubber, or silicone strap while Image 2/sample shows a steel bracelet, keep the Image 1 strap material and render both strap halves as continuous full-length pieces extending naturally from the lugs. Do not let either strap half stop abruptly near the case, fade into the background, merge into the surface, become a short stump, or get cut off by the frame. If needed, zoom out or adjust placement so the strap ends stay inside the image.
Match Image 2's wrist position, perspective, lighting, shadows, and background so the final image looks like a real product photo.
If scene fit conflicts with product accuracy, prioritize the watch design from Image 1.

## [MALE] PROMPT FOR MEN'S WATCHES - SKU HAS G

### MALE-1 - Common two-image watch replacement
**Sample Image:** N/A
**English instruction for GPT:**
> Use only the two images attached in this message.

Image 1 is the exact product watch.
Image 2 is only the scene, wrist, lighting, camera angle, and background reference.

Product gender rule for SKU with G:
If Image 2 contains a hand, wrist, or forearm, keep that hand/wrist/forearm from Image 2 unchanged except for replacing the watch. Keep the original wrist position, anatomy, gender, skin texture, lighting, and shadows. Do not convert the hand to female and do not restyle the person.
If Image 2 DOES NOT contain a human hand, wrist, or forearm, DO NOT add any human body parts. Keep the lighting, shadows, and background exactly as in Image 2.

Remove the watch currently visible in Image 2 and replace it with the watch from Image 1.
Preserve the watch from Image 1 as closely as possible: case shape, bezel, dial layout, hands, bracelet or strap style, color, and overall proportions.
Do not copy the watch design from Image 2.
Keep the watch at a realistic adult wristwatch size. On wrist shots, the watch case should look prominent and natural on the wrist, not tiny or miniature.
On wrist shots, the bracelet or strap must look physically real: both sides must attach cleanly to the lugs, curve naturally around the wrist, keep the same material/width/detail from Image 1, and create subtle contact shadows where it touches skin or sleeve. The strap must not look like a flat black patch, painted band, melted cuff, floating slab, broken strip, oversized cuff, or fake sticker on the wrist.
For flat lay, table, fabric, product-only, or any non-wrist scene, the bracelet or strap from Image 1 must remain complete and uncropped. If Image 1 has a leather, rubber, or silicone strap while Image 2/sample shows a steel bracelet, keep the Image 1 strap material and render both strap halves as continuous full-length pieces extending naturally from the lugs. Do not let either strap half stop abruptly near the case, fade into the background, merge into the surface, become a short stump, or get cut off by the frame. If needed, zoom out or adjust placement so the strap ends stay inside the image.
Match Image 2's wrist position, perspective, lighting, shadows, and background so the final image looks like a real product photo.
If scene fit conflicts with product accuracy, prioritize the watch design from Image 1.

---

## [FEMALE] PROMPT FOR WOMEN'S WATCHES - SKU HAS L

### FEMALE-1 - Common two-image watch replacement
**Sample Image:** N/A
**English instruction for GPT:**
> Use only the two images attached in this message.

Image 1 is the exact product watch.
Image 2 is only the scene, wrist, lighting, camera angle, and background reference.

Product gender rule for SKU with L:
If Image 2 contains a hand, wrist, or forearm, do not keep a male or masculine-looking hand/wrist. Keep Image 2's wrist position, perspective, lighting, shadows, and background, but change the visible hand/wrist/forearm into a normal natural female hand/wrist. The female hand must be healthy and naturally full, anatomically correct, with normal finger count, no extra fingers, no missing fingers, no fused fingers, no distorted joints, not overly thin, not hairy, not veiny/masculine, and not deformed. Only change the hand/wrist gender cues needed for a believable female wrist; keep the scene composition.
If Image 2 DOES NOT contain a human hand, wrist, or forearm, DO NOT add any human body parts. Keep the lighting, shadows, and background exactly as in Image 2.

Remove the watch currently visible in Image 2 and replace it with the watch from Image 1.
Preserve the watch from Image 1 as closely as possible: case shape, bezel, dial layout, hands, bracelet or strap style, color, and overall proportions.
Do not copy the watch design from Image 2.
Keep the watch at a realistic adult wristwatch size. On wrist shots, the watch case should look prominent and natural on the wrist, not tiny or miniature.
On wrist shots, the bracelet or strap must look physically real: both sides must attach cleanly to the lugs, curve naturally around the wrist, keep the same material/width/detail from Image 1, and create subtle contact shadows where it touches skin or sleeve. The strap must not look like a flat black patch, painted band, melted cuff, floating slab, broken strip, oversized cuff, or fake sticker on the wrist.
For flat lay, table, fabric, product-only, or any non-wrist scene, the bracelet or strap from Image 1 must remain complete and uncropped. If Image 1 has a leather, rubber, or silicone strap while Image 2/sample shows a steel bracelet, keep the Image 1 strap material and render both strap halves as continuous full-length pieces extending naturally from the lugs. Do not let either strap half stop abruptly near the case, fade into the background, merge into the surface, become a short stump, or get cut off by the frame. If needed, zoom out or adjust placement so the strap ends stay inside the image.
Match Image 2's wrist position, perspective, lighting, shadows, and background so the final image looks like a real product photo.
If scene fit conflicts with product accuracy, prioritize the watch design from Image 1.

---

## [NEUTRAL] PROMPT WHEN SKU GENDER IS UNKNOWN

### NEUTRAL-1 - Common two-image watch replacement
**Sample Image:** N/A
**English instruction for GPT:**
> Use only the two images attached in this message.

Image 1 is the exact product watch.
Image 2 is only the scene, wrist, lighting, camera angle, and background reference.

If Image 2 DOES NOT contain a human hand, wrist, or forearm, DO NOT add any human body parts. Keep the lighting, shadows, and background exactly as in Image 2.

Remove the watch currently visible in Image 2 and replace it with the watch from Image 1.
Preserve the watch from Image 1 as closely as possible: case shape, bezel, dial layout, hands, bracelet or strap style, color, and overall proportions.
Do not copy the watch design from Image 2.
Keep the watch at a realistic adult wristwatch size. On wrist shots, the watch case should look prominent and natural on the wrist, not tiny or miniature.
On wrist shots, the bracelet or strap must look physically real: both sides must attach cleanly to the lugs, curve naturally around the wrist, keep the same material/width/detail from Image 1, and create subtle contact shadows where it touches skin or sleeve. The strap must not look like a flat black patch, painted band, melted cuff, floating slab, broken strip, oversized cuff, or fake sticker on the wrist.
For flat lay, table, fabric, product-only, or any non-wrist scene, the bracelet or strap from Image 1 must remain complete and uncropped. If Image 1 has a leather, rubber, or silicone strap while Image 2/sample shows a steel bracelet, keep the Image 1 strap material and render both strap halves as continuous full-length pieces extending naturally from the lugs. Do not let either strap half stop abruptly near the case, fade into the background, merge into the surface, become a short stump, or get cut off by the frame. If needed, zoom out or adjust placement so the strap ends stay inside the image.
Match Image 2's wrist position, perspective, lighting, shadows, and background so the final image looks like a real product photo.
If scene fit conflicts with product accuracy, prioritize the watch design from Image 1.

---
