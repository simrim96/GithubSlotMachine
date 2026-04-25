import random
import time
import os

def play():
    # Forza la generazione casuale
    random.seed(time.time())
    icons = ["🍒", "💎", "🍋", "7️⃣", "🔔", "⭐"]
    # Scegliamo 3 icone (possono anche essere uguali, come in una slot vera)
    res = [random.choice(icons) for _ in range(3)]
    
    unique_id = int(time.time())
    
    # Carichiamo il template
    try:
        with open("slot_template.svg", "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        print("ERRORE: slot_template.svg non trovato!")
        return

    # Debug: stampiamo cosa abbiamo scelto (lo vedrai nei log di GitHub)
    print(f"Icone estratte: {res}")

    # Eseguiamo le sostituzioni
    content = content.replace("{s1}", str(res[0]))
    content = content.replace("{s2}", str(res[1]))
    content = content.replace("{s3}", str(res[2]))
    
    # Sostituiamo il segnaposto dell'animazione con un nome unico
    content = content.replace("slot_anim", f"anim_{unique_id}")

    # Scriviamo il file finale
    with open("slot.svg", "w", encoding="utf-8") as f:
        f.write(content)
    
    print("File slot.svg aggiornato con successo.")

if __name__ == "__main__":
    play()
