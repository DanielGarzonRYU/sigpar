# SIGPAR: web + API PHP en UN solo contenedor (un solo servicio en Render = cabe en las 750 h gratis).
FROM php:8.2-apache

# Extensión MySQL, OPcache (PHP no recompila en cada petición), rewrite para /api y zona horaria de Colombia
RUN docker-php-ext-install pdo_mysql opcache \
 && a2enmod rewrite headers expires deflate \
 && echo "date.timezone=America/Bogota" > /usr/local/etc/php/conf.d/tz.ini \
 && echo "expose_php=Off" > /usr/local/etc/php/conf.d/security.ini \
 && printf 'opcache.enable=1\nopcache.memory_consumption=64\nopcache.max_accelerated_files=4000\nopcache.validate_timestamps=0\n' > /usr/local/etc/php/conf.d/opcache.ini

# Render gratis tiene 512 MB de RAM: se limita Apache a 12 procesos (~25 MB c/u) para no agotar la memoria.
# También limita las conexiones simultáneas a MySQL (el plan gratis de Aiven admite pocas).
RUN printf '<IfModule mpm_prefork_module>\n  StartServers 2\n  MinSpareServers 2\n  MaxSpareServers 4\n  MaxRequestWorkers 12\n  MaxConnectionsPerChild 1000\n</IfModule>\nKeepAliveTimeout 3\n' > /etc/apache2/conf-available/sigpar-mpm.conf \
 && a2enconf sigpar-mpm

# La raíz pública es /public; el backend queda fuera del alcance web
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
 && sed -ri 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
 && printf '<Directory /var/www/html/public>\n  AllowOverride All\n  Require all granted\n  Options -Indexes\n</Directory>\nServerTokens Prod\nServerSignature Off\n' > /etc/apache2/conf-available/sigpar.conf \
 && a2enconf sigpar

COPY . /var/www/html/
RUN rm -rf /var/www/html/documentos /var/www/html/.env \
 && chown -R www-data:www-data /var/www/html

# Render indica el puerto en la variable PORT (por defecto 10000)
COPY docker/start.sh /usr/local/bin/start-sigpar
RUN chmod +x /usr/local/bin/start-sigpar
EXPOSE 10000
CMD ["start-sigpar"]
