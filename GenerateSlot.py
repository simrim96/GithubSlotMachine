import random

def play():
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    res = [random.choice(icons) for _ in range(3)]
    
    # Determina se c'è una vincita
    is_win = res[0] == res[1] == res[2]
    status = "JACKPOT! 🎉" if is_win else "Riprova! 🎰"

    # Leggi il template e sostituisci i valori
    with open("slot_template.svg", "r", encoding="utf-8") as f:
        template = f.read()

    new_svg = template.format(s1=res[0], s2=res[1], s3=res[2], status=status)

    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(new_svg)

if __name__ == "__main__":
    play()
