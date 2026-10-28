import { TestBed } from '@angular/core/testing';

import { ChatStreamService } from './chat-stream.service';

describe('ChatStreamService', () => {
  let service: ChatStreamService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChatStreamService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
