class CustomError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}

export default CustomError;
