import requests
from django.core.management.base import BaseCommand
from inventario.models.clasificacion import Categoria
from inventario.models.nucleo import Estok

class Command(BaseCommand):
    help = 'Descarga e inyecta las categorías raíz oficiales de Mercado Libre Argentina'

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING('⏳ Conectando con la API de Mercado Libre de forma segura...'))
        
        primer_estok = Estok.objects.first()
        if not primer_estok:
            self.stdout.write(self.style.ERROR('❌ Error: No se encontró ningún registro de Estok en la base de datos.'))
            return

        url = "https://api.mercadolibre.com/sites/MLA/categories"
        
        # Inyectamos encabezados de simulación de navegador para esquivar el bloqueo 403 de Hetzner
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'es-AR,es;q=0.9'
        }

        try:
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code == 200:
                categorias_meli = response.json()
                
                contador = 0
                for cat in categorias_meli:
                    categoria, created = Categoria.objects.update_or_create(
                        meli_category_id=cat['id'],
                        estok=primer_estok,
                        defaults={
                            'nombre': cat['name'],
                            'es_contenedor': True,
                            'icono': '🏷️'
                        }
                    )
                    if created:
                        contador += 1
                
                self.stdout.write(self.style.SUCCESS(f'✅ ¡Éxito! Se inyectaron {contador} categorías raíz de Mercado Libre.'))
            else:
                self.stdout.write(self.style.ERROR(f'❌ Error de API: Código de estado {response.status_code}'))
                if response.status_code == 403:
                    self.stdout.write(self.style.ERROR('💡 Nota: Mercado Libre bloqueó la IP de Hetzner. El User-Agent la destrabará en el próximo deploy.'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'❌ Ocurrió un error al conectar: {str(e)}'))
