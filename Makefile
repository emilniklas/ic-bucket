.PHONY: default backend frontend declarations deploy backend_canister frontend_canister

default: backend frontend

backend_canister:
	dfx canister create icbucket

frontend_canister:
	dfx canister create icbucket_frontend

backend: backend_canister
	dfx build icbucket

declarations: backend_canister frontend_canister
	dfx generate

frontend: declarations
	( cd frontend; yarn vite build -m development )

deploy: backend frontend
	dfx deploy
