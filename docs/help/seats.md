# Seats

Channels and thresholds for every seat in the active frequency profile. Pick a channel
from the band grid, tune enter and exit thresholds from a captured trace, and save
presets. Everything writes to RotorHazard and is read back.

While a race is staged or running, channel and profile changes are refused and the page
says so: RotorHazard would retune the seat mid-race. Enter and exit still write live.

Enter and exit take whole numbers from 1 to 255, exit below enter; anything else is refused
with the box named, and RotorHazard's values come back. A profile cannot take a name another
profile already has.
