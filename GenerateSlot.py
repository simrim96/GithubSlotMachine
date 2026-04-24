import random
import time

def play():
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    res = [random.choice(icons) for _ in range(3)]
    
    is_win = res[0] == res[1] == res[2]
    status = "JACKPOT! 🎉" if is_win else "Riprova! 🎰"
    
    # Generiamo un timestamp per rendere il file unico
    timestamp = str(time.time())

    with open("slot_template.svg", "r", encoding="utf-8") as f:
        template = f.read()

    # Aggiungiamo il timestamp come commento XML alla fine dell'SVG
    # e popoliamo i placeholder
    new_svg = template.format(s1=res[0], s2=res[1], s3=res[2], status=status)
    new_svg += f""

    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(new_svg)

if __name__ == "__main__":
    play()
