# Reklamfiguren

En 3D-figur där företag budar på reklamytor på tröjan och byxorna. Det ledande budet trycks på plagget.

- Sidan är en enda fil, `index.html`, och publiceras med GitHub Pages.
- Buden sparas i Supabase-tabellen `public.reklamfiguren_bud`. Alla besökare kan läsa och lägga bud, men ingen kan ändra eller ta bort dem. Bud under utropspriset eller minsta höjning stoppas av databasen.
- Auktionen stänger 30 november 2026 kl. 20:00. Datumet finns både i `index.html` och i databasfunktionen `reklamfiguren_validera_bud`.
- Köparen väljer vad som ska synas på ytan: en text (`ad_text`, högst 40 tecken) eller en bild/logotyp (`image_data`). Bilden krymps i webbläsaren till högst 512 pixlar och sparas som en liten data-URL direkt i tabellen; SVG och för stora bilder stoppas av databasen. `brand` är köparens namn och visas under annonsen.
- Allt som laddas upp visas direkt för alla besökare. Ta bort olämpligt innehåll genom att radera budets rad i Supabase under Table Editor → `reklamfiguren_bud`; då visas nästa högsta bud på ytan.

## Figuren

Figuren är en 3D-skanning av en riktig person: en helkroppsskanning och en separat närskanning av huvudet, båda gjorda med en iPhone. Råskanningarna ligger inte i repot. Sidan laddar `figure.bin.gz` (form och skelett) och fototexturerna `scan-body.jpg`, `scan-body-n.jpg` och `scan-head.jpg`.

Så här byggs figuren om från två GLB-filer, utpackade till `mesh.json` och texturer i en arbetsmapp:

1. `node tools/scan/clean.mjs` tar bort golvet och skalar kroppen till 1,80 m.
2. `python3 -I tools/scan/align_head.py` passar in huvudskanningen på kroppens huvud.
3. `python3 -I tools/scan/merge.py` klipper bort kroppens eget huvud och fötterna, och huvudskanningen nedanför halsen.
4. `python3 -I tools/scan/rig.py` lägger in skelettet, skär loss armarna från kroppen och räknar ut benvikter.
5. `python3 -I tools/scan/texture.py` färgar tröjan och shortsen svarta och förbereder texturerna.
6. `node tools/build-scan.mjs <arbetsmapp>` lägger till strumpor och sneakers och skriver `figure.bin.gz`.

Varje skript beskriver sina argument överst i filen.

`tools/build-human.mjs`, `tools/mh/` och `vendor/makehuman/` är den tidigare, genererade figuren som byggde på [MakeHuman](https://github.com/makehumancommunity/makehuman) (CC0, se `vendor/makehuman/LICENSE.ASSETS.md`). `tools/mh/mesher.mjs` används fortfarande för skorna.

## Betalning med faktura

När auktionen stänger (30 november kl. 20:00) faktureras vinnarna. Ingen betalning sker på sidan.

1. **Vid budet** anger budgivaren sin e-post. Den sparas i `reklamfiguren_kontakt`, som besökare inte kan läsa. Bud läggs via funktionen `reklamfiguren_lagg_bud`, så att bud och e-post sparas tillsammans.
2. **Vid stängning** kör pg_cron Supabase-funktionen `reklamfiguren-stang` (källkod i `supabase/functions/`). Den utser vinnaren på varje yta till `reklamfiguren_vinst` och mejlar en personlig länk, `?vinst=<token>`, till fakturaformuläret.
3. **Vinnaren** öppnar länken och fyller i namn, organisations- eller personnummer, adress och fakturamejl. Uppgifterna kan ändras tills fakturan är markerad som skickad.
4. **Du fakturerar** från vyn `reklamfiguren_vinnare` i Supabase (SQL Editor eller Table Editor). Den visar yta, belopp, köpare, e-post, fakturauppgifter och länken. Markera `fakturerad_at` och `betald_at` i `reklamfiguren_vinst` när du skickat fakturan och fått betalt.

Mejlen skickas via [Resend](https://resend.com) när Supabase-hemligheterna `RESEND_API_KEY` och `REKLAMFIGUREN_FROM` (avsändare, till exempel `Reklamfiguren <auktion@dindoman.se>`) är satta. Utan dem utses vinnarna ändå, och du kan mejla länkarna från vinnarlistan själv. Funktionen kan köras om utan risk: varje vinnare mejlas bara en gång.
