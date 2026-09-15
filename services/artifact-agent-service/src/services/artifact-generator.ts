import type { AppConfig } from '../config.js';
import type { GenerateArtifactRequest, GenerateArtifactResponse } from '../schemas.js';
import { ChatArtifactService } from './chat-service.js';

export class ArtifactGeneratorService {
  private readonly chatService: ChatArtifactService;

  constructor(config: AppConfig) {
    this.chatService = new ChatArtifactService(config);
  }

  async generate(request: GenerateArtifactRequest): Promise<GenerateArtifactResponse> {
    const result = await this.chatService.chat({
      messages: [{ role: 'user', content: request.prompt }],
      slug: request.slug,
      roles: request.roles,
    });

    return {
      slug: result.slug,
      title: result.title,
      reply: result.reply,
      roles: result.roles,
      url_path: result.url_path,
      preview_url: result.preview_url,
      files_written: result.files_written,
    };
  }
}
