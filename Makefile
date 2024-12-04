schemas:
	glib-compile-schemas schemas/

install: schemas

test/prefs:
	gnome-extensions prefs cursor-usage@ttys3.github.io
