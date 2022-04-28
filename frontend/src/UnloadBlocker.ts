export class UnloadBlocker {
  readonly #message: string;

  constructor(message: string) {
    this.#message = message;
  }

  block() {
    window.addEventListener("beforeunload", this.#beforeUnload)
  }

  unblock() {
    window.removeEventListener("beforeunload", this.#beforeUnload)
  }

  #beforeUnload = (e: BeforeUnloadEvent): string => {
    e.preventDefault();
    return e.returnValue = this.#message;
  }
}
