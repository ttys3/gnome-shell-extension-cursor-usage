schemas/gschemas.compiled:
	glib-compile-schemas schemas/

cursor-api-http-client:
	go build -ldflags="-s -w" -o cursor-api-http-client main.go

install: schemas/gschemas.compiled cursor-api-http-client

test/prefs:
	gnome-extensions prefs cursor-usage@ttys3.github.io

clean:
	rm -f schemas/gschemas.compiled cursor-api-http-client
