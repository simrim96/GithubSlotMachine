import random
import time

def play():
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    res = [random.choice(icons) for _ in range(3)]
    
    is_win = res[0] == res[1] == res[2]
    status = "JACKPOT! 🎉" if is_win else "Riprova! 🎰"
    
    timestamp = str(time.time())

    with open("SlotTemplate.svg", "r", encoding="utf-8") as f:
        template = f.read()

    # Sostituiamo i segnaposto uno per uno
    new_svg = template.replace("{s1}", res[0])
    new_svg = new_svg.replace("{s2}", res[1])
    new_svg = new_svg.replace("{s3}", res[2])
    new_svg = new_svg.replace("{status}", status)
    
    # Aggiungiamo il cache buster come commento
    new_svg += f""

    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(new_svg)

if __name__ == "__main__":
    play()
