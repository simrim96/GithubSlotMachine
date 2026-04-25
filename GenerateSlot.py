import random
import time

def play():
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    res = [random.choice(icons) for _ in range(3)]
    
    # Creiamo un ID unico basato sul tempo (es. spin17140800)
    spin_id = f"spin{int(time.time())}"

    with open("slot_template.svg", "r", encoding="utf-8") as f:
        template = f.read()

    # Sostituiamo i simboli E il nome dell'animazione
    new_svg = template.replace("{s1}", res[0])
    new_svg = new_svg.replace("{s2}", res[1])
    new_svg = new_svg.replace("{s3}", res[2])
    new_svg = new_svg.replace("spin_placeholder", spin_id) # Cambiamo il nome dell'animazione

    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(new_svg)
