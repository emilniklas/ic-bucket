.PHONY: default backend frontend declarations deploy

default: backend frontend

backend:
	dfx build icbucket

declarations:
	dfx generate icbucket

frontend: declarations
	( cd frontend; yarn vite build -m development )

deploy: backend frontend
	dfx deploy
