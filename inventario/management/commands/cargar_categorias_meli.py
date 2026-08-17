import requests
from django.core.management.base import BaseCommand
from inventario.models.clasificacion import Categoria
from inventario.models.nucleo import Estok

class Command(BaseCommand):
    help = 'Descarga e inyecta las categorías raíz oficiales de Mercado Libre Argentina'

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING('⏳ Conectando con la API de Mercado Libre...'))
        
        primer_estok = Estok.objects.first()
        if not primer_estok:
            self.stdout.write(self.style.ERROR('❌ Error: No se encontró ningún registro de Estok en la base de datos.'))
            return

        url = "https://mercadolibre.com"
        try:
            response = requests.get(url, timeout=10)
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
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'❌ Ocurrió un error al conectar: {str(e)}'))
