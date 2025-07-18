pack: cursor-api-http-client schemas/gschemas.compiled
	gnome-extensions pack --extra-source=cursor-api-http-client

schemas/gschemas.compiled:
	glib-compile-schemas schemas/

cursor-api-http-client:
	go build -ldflags="-s -w" -o cursor-api-http-client main.go

install: schemas/gschemas.compiled cursor-api-http-client
	gnome-extensions disable cursor-usage@ttys3.github.io
	make pack
	gnome-extensions install cursor-usage@ttys3.github.io.shell-extension.zip
	gnome-extensions enable cursor-usage@ttys3.github.io

test/prefs:
	gnome-extensions prefs cursor-usage@ttys3.github.io

clean:
	rm -f schemas/gschemas.compiled
	rm -f cursor-api-http-client
	rm -f cursor-usage@ttys3.github.io.shell-extension.zip
