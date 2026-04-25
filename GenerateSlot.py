import random
import time

def play():
    random.seed(time.time())
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    res = [random.choice(icons) for _ in range(3)]
    
    # Crea un ID unico per l'animazione basato sul tempo
    unique_id = int(time.time())
    spin_name = f"spin_{unique_id}"

    with open("slot_template.svg", "r", encoding="utf-8") as f:
        template = f.read()

    # Sostituzione dei simboli e del nome animazione
    new_svg = template.replace("{s1}", res[0])
    new_svg = new_svg.replace("{s2}", res[1])
    new_svg = new_svg.replace("{s3}", res[2])
    new_svg = new_svg.replace("spin_placeholder", spin_name)
    
    # Alla fine del tuo script Python, prima di scrivere il file:
    timestamp_comment = f"\n"
    new_svg += timestamp_comment
    
    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(new_svg)
