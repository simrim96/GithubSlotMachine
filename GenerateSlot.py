import random
import time
import os

def play():
    # 1. Forza la generazione di numeri casuali veri
    random.seed(time.time())
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    res = random.sample(icons, 3) # Usa sample per avere icone diverse
    
    unique_id = int(time.time())
    
    # 2. Carica il template (assicurati che il percorso sia corretto)
    with open("SlotTemplate.svg", "r", encoding="utf-8") as f:
        content = f.read()

    # 3. Sostituzioni (usa nomi univoci per l'animazione)
    content = content.replace("{s1}", res[0])
    content = content.replace("{s2}", res[1])
    content = content.replace("{s3}", res[2])
    content = content.replace("slot_anim", f"anim_{unique_id}")

    # 4. Scrittura atomica
    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())

if __name__ == "__main__":
    play()
