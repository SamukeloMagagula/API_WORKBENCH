<?php
declare(strict_types=1);

/** An error the proxy reports to the browser as {ok:false, error:{code, message}}. */
final class ProxyException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $httpStatus = 400,
    ) {
        parent::__construct($message);
    }
}
