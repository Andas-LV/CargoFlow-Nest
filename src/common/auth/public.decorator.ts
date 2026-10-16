import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Эндпоинт доступен без access-токена. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
