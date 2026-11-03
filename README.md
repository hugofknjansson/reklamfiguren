# Reklamfiguren

En 3D-figur där företag budar på reklamytor på tröjan och byxorna. Det ledande budet trycks på plagget.

- Sidan är en enda fil, `index.html`, och publiceras med GitHub Pages.
- Buden sparas i Supabase-tabellen `public.reklamfiguren_bud`. Alla besökare kan läsa och lägga bud, men ingen kan ändra eller ta bort dem. Bud under utropspriset eller minsta höjning stoppas av databasen.
- Auktionen stänger 30 november 2026 kl. 20:00. Datumet finns både i `index.html` och i databasfunktionen `reklamfiguren_validera_bud`.
- Ta bort ett oönskat bud i Supabase under Table Editor → `reklamfiguren_bud`.
