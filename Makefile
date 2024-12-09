schemas/gschemas.compiled:
	glib-compile-schemas schemas/

install: schemas/gschemas.compiled

test/prefs:
	gnome-extensions prefs cursor-usage@ttys3.github.io

clean:
	rm -f schemas/gschemas.compiled
