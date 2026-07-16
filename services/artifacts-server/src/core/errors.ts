export class ArtifactNotFoundError extends Error {
  constructor(message = 'Artifact not found') {
    super(message);
    this.name = 'ArtifactNotFoundError';
  }
}

export class AuthenticationRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationRequiredError';
  }
}

export class ArtifactForbiddenError extends Error {
  constructor(message = 'Not authorized to access this artifact') {
    super(message);
    this.name = 'ArtifactForbiddenError';
  }
}
