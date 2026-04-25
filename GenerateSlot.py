import random
import time

def play():
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    res = [random.choice(icons) for _ in range(3)]
    
    # Questo ID cambia ogni secondo, rendendo l'animazione "nuova" per il browser
    unique_id = int(time.time())

    with open("slot_template.svg", "r", encoding="utf-8") as f:
        template = f.read()

    new_svg = template.replace("{s1}", res[0])
    new_svg = new_svg.replace("{s2}", res[1])
    new_svg = new_svg.replace("{s3}", res[2])
    # Cambiamo il nome dell'animazione nel CSS
    new_svg = new_svg.replace("slot-spin", f"spin-{unique_id}")
    # Aggiungiamo un commento per cambiare il checksum del file
    new_svg += f""

    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(new_svg)
