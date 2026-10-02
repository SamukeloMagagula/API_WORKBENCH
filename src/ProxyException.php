<?php
declare(strict_types=1);

/** An error the proxy reports to the browser as {ok:false, error:{code, message}}. */
final class ProxyException extends RuntimeException
{
    public function __construct(
        public string $errorCode,
        string $message,
        public int $httpStatus = 400,
    ) {
        parent::__construct($message);
    }
}
